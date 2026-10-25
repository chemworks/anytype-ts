import { arrayMove } from '@dnd-kit/sortable';
import * as I from 'Interface';
import * as M from 'Model';
import Storage from 'Lib/storage';

class Dataview {

	/**
	 * Gets the relations for a dataview, ordered and filtered for visibility.
	 * @param {string} rootId - The root object ID.
	 * @param {string} blockId - The block ID.
	 * @param {I.View} view - The dataview object.
	 * @returns {I.ViewRelation[]} The list of view relations.
	 */
	viewGetRelations (rootId: string, blockId: string, view: I.View): I.ViewRelation[] {
		if (!view) {
			return [];
		};

		const { config } = S.Common;
		const order: any = {};
		const viewRelations = (view.relations || []).filter(it => it);

		let relations = S.Record.getDataviewRelations(rootId, blockId);

		if (!relations.find(it => it.relationKey == 'name')) {
			const nr = S.Record.getRelationByKey('name');
			if (nr) {
				relations.unshift(nr);
			};
		};

		relations = U.Common.objectCopy(relations).filter(it => it && !it.isArchived && !it.isDeleted);

		if (!config.debug.hiddenObject) {
			relations = relations.filter(it => (it.relationKey == 'name') || !it.isHidden);
		};

		let o = 0;
		viewRelations.forEach(it => order[it.relationKey] = o++);

		relations.forEach(it => {
			if (it && (undefined === order[it.relationKey])) {
				order[it.relationKey] = o++;
			};
		});

		relations.sort((c1: any, c2: any) => {
			const o1 = order[c1.relationKey];
			const o2 = order[c2.relationKey];

			if (o1 > o2) return 1;
			if (o1 < o2) return -1;
			return 0;
		});

		const ret = relations.map(relation => {
			const vr = viewRelations.find(it => it.relationKey == relation.relationKey) || {};

			if ((view.type != I.ViewType.Gallery) && (relation.relationKey == 'name')) {
				vr.isVisible = true;
			};

			return new M.ViewRelation({
				...vr,
				relationKey: relation.relationKey,
				width: Relation.width(vr.width, relation.format),
			});
		});

		return U.Common.arrayUniqueObjects(ret, 'relationKey');
	};

	/**
	 * Adds a relation to a dataview and updates the view.
	 * @param {string} rootId - The root object ID.
	 * @param {string} blockId - The block ID.
	 * @param {string} relationKey - The relation key to add.
	 * @param {number} index - The index to insert at.
	 * @param {I.View} view - The dataview view object.
	 * @param {function} [callBack] - Optional callback after addition.
	 */
	relationAdd (rootId: string, blockId: string, relationKey: string, index: number, view: I.View, callBack?: (message: any) => void) {
		C.BlockDataviewRelationAdd(rootId, blockId, [ relationKey ], (message: any) => {
			this.viewRelationAdd(rootId, blockId, relationKey, index, view, callBack);
		});
	};

	/**
	 * Adds a relation to a dataview view and sorts it.
	 * @param {string} rootId - The root object ID.
	 * @param {string} blockId - The block ID.
	 * @param {string} relationKey - The relation key to add.
	 * @param {number} index - The index to insert at.
	 * @param {I.View} [view] - The dataview view object.
	 * @param {function} [callBack] - Optional callback after addition.
	 */
	viewRelationAdd (rootId: string, blockId: string, relationKey: string, index: number, view?: I.View, callBack?: (message: any) => void) {
		if (!view) {
			return;
		};

		const rel: any = view.getRelation(relationKey) || {};

		rel.relationKey = relationKey;
		rel.width = rel.width || J.Size.dataview.cell.default;
		rel.isVisible = true;

		C.BlockDataviewViewRelationReplace(rootId, blockId, view.id, relationKey, rel, (message: any) => {
			if (index >= 0) {
				const newView = S.Record.getView(rootId, blockId, view.id);
				const oldIndex = (newView.relations || []).findIndex(it => it.relationKey == relationKey);
				
				let keys = newView.relations.map(it => it.relationKey);
				if (oldIndex < 0) {
					keys.splice(index, 0, relationKey);
				} else {
					keys = arrayMove(keys, oldIndex, index);
				};

				C.BlockDataviewViewRelationSort(rootId, blockId, view.id, keys, callBack);
			} else {
				callBack?.(message);
			};
		});
	};

	/**
	 * Gets data for a dataview subscription, applying filters and sorts.
	 * @param {any} param - The parameters for the data request.
	 * @param {function} [callBack] - Optional callback after data is received.
	 */
	getData (param: any, callBack?: (message: any) => void) {
		param = Object.assign({
			rootId: '',
			blockId: '',
			subId: '',
			newViewId: '',
			keys: J.Relation.default,
			offset: 0,
			limit: 0,
			sources: [],
			clear: false,
			isInline: false,
			collectionId: '',
			filters: [],
			sorts: [],
		}, param);

		const { rootId, blockId, newViewId, keys, offset, limit, collectionId, clear, isInline } = param;
		const block = S.Block.getLeaf(rootId, blockId);
		const view = S.Record.getView(rootId, blockId, newViewId);

		if (!view) {
			return;
		};

		const subId = param.subId || S.Record.getSubId(rootId, blockId);
		const { viewId } = S.Record.getMeta(subId, '');
		const viewChange = newViewId != viewId;
		const meta: any = { offset };
		const viewFilters = this.getActiveFilters(view);
		
		let filters = viewFilters.concat(param.filters || []).concat([
			{ relationKey: 'resolvedLayout', condition: I.FilterCondition.NotIn, value: U.Object.excludeFromSet() },
		]);
		let sorts = U.Common.objectCopy(view.sorts).concat(param.sorts || []);

		const order = block ? block.content.objectOrder.find(it => (it.viewId == view.id) && (it.groupId == '')) : null;
		const orderIds = order ? order.objectIds || [] : [];

		// The record order is defined by explicit view sorts only when no manual order
		// overrides them: for such subscriptions the dispatcher lets SubscriptionAdd
		// reposition optimistically inserted records to the middleware position (GO-7387)
		meta.isSorted = !orderIds.length && (this.getFilteredSorts(sorts).length > 0);

		if (viewChange) {
			meta.viewId = newViewId;
		};

		if (!sorts.length) {
			sorts.push({ relationKey: 'createdDate', type: I.SortType.Desc, includeTime: true });
		};

		if (!isInline && (viewChange || clear)) {
			S.Record.recordsSet(subId, '', []);
		};

		S.Record.metaSet(subId, '', meta);

		if (orderIds.length) {
			sorts.unshift({ relationKey: 'id', type: I.SortType.Custom, customOrder: orderIds });
		};

		filters = this.getFilteredFilters(filters).map(it => this.filterMapper({ ...it, includeTime: false }, { rootId }));
		sorts = this.getFilteredSorts(sorts).map(it => this.sortMapper(it));

		const cb = () => {
			U.Subscription.subscribe({
				...param,
				subId,
				filters,
				sorts,
				keys,
				limit,
				offset,
				collectionId,
			}, callBack);
		};

		if (clear) {
			U.Subscription.destroyList([ subId ], false, cb);
		} else {
			cb();
		};
	};

	/**
	 * Loads all object IDs matching the current view's query, for export.
	 * Reconstructs the exact same filters, sorts, sources and collection as the
	 * live dataview subscription, but fetches every matching record (no page limit)
	 * via a temporary subscription which is destroyed once the IDs are collected.
	 * @param {string} rootId - The root object ID.
	 * @param {string} blockId - The block ID.
	 * @param {function} callBack - Called with the resulting array of object IDs.
	 */
	loadExportIds (rootId: string, blockId: string, callBack: (ids: string[]) => void) {
		const view = this.getView(rootId, blockId);
		const block = S.Block.getLeaf(rootId, blockId);

		if (!view || !block) {
			callBack([]);
			return;
		};

		const isCollection = this.isCollection(rootId, blockId);
		const targetId = block.getTargetObjectId() || rootId;
		const object = S.Detail.get(rootId, targetId, [ 'setOf' ]);
		const subId = [ S.Record.getSubId(rootId, blockId), 'export' ].join('-');

		let sources: string[] = [];
		if (!isCollection) {
			const types = Relation.getSetOfObjects(rootId, targetId, I.ObjectLayout.Type).map(it => it.id);
			const relations = Relation.getSetOfObjects(rootId, targetId, I.ObjectLayout.Relation).map(it => it.id);

			sources = [].concat(types).concat(relations);

			if (!sources.length) {
				callBack([]);
				return;
			};
		};

		let filters = this.getActiveFilters(view).concat([
			{ relationKey: 'resolvedLayout', condition: I.FilterCondition.NotIn, value: U.Object.excludeFromSet() },
		]);
		let sorts = U.Common.objectCopy(view.sorts);

		if (!sorts.length) {
			sorts.push({ relationKey: 'createdDate', type: I.SortType.Desc, includeTime: true });
		};

		const el = block.content.objectOrder.find(it => (it.viewId == view.id) && (it.groupId == ''));
		const objectIds = el ? el.objectIds || [] : [];

		if (objectIds.length) {
			sorts.unshift({ relationKey: 'id', type: I.SortType.Custom, customOrder: objectIds });
		};

		filters = this.getFilteredFilters(filters).map(it => this.filterMapper({ ...it, includeTime: false }, { rootId }));
		sorts = this.getFilteredSorts(sorts).map(it => this.sortMapper(it));

		U.Subscription.subscribe({
			subId,
			filters,
			sorts,
			sources,
			keys: [ 'id' ],
			collectionId: isCollection ? object.id : '',
			noDeps: true,
		}, (message: any) => {
			const ids = (message.records || []).map(it => it.id).filter(it => it);

			U.Subscription.destroyList([ subId ]);
			callBack(ids);
		});
	};

	/**
	 * Returns only active filters from given view.
	 * @param {I.View} view - The dataview view object.
	 * @returns {I.Filter[]} Array of filter objects.
	 */
	getActiveFilters (view: I.View): I.Filter[] {
		if (!view) {
			return [];
		};

		const filters = this.getFilteredFilters(view.filters);
		return filters.filter(it => Relation.isFilterActive(it));
	};

	/**
	 * Maps a filter object for a dataview subscription.
	 * @param {any} view - The dataview view object.
	 * @param {any} it - The filter or sort object.
	 * @param {any} [param] - Additional parameters, e.g., rootId.
	 * @returns {any} The mapped object.
	 */
	filterMapper (it: any, param?: any) {
		if (it.relationKey) {
			const relation = S.Record.getRelationByKey(it.relationKey);
			if (!relation) {
				return it;
			};

			const isArrayType = Relation.isArrayType(relation.format);
			const mapArray = (v: any, fn: (v: any) => any) => Array.isArray(v) ? v.map(fn) : fn(v);

			it.format = relation.format;

			if (undefined === it.includeTime) {
				it.includeTime = relation.includeTime;
			};

			if (isArrayType) {
				it.value = Relation.formatValue(relation, it.value, false);
				it.value = mapArray(it.value, v => this.valueTemplateMapper(v, param));
			} else {
				it.value = mapArray(it.value, v => Relation.formatValue(relation, v, false));
			};
		};

		if (it.nestedFilters && it.nestedFilters.length) {
			it.nestedFilters = it.nestedFilters.map(child => this.filterMapper({ ...child, includeTime: false }, param));
		};

		return it;
	};

	/**
	 * Maps a sort object for a dataview subscription.
	 * @param {any} view - The dataview view object.
	 * @param {any} it - The filter or sort object.
	 * @returns {any} The mapped object.
	 */
	sortMapper (it: any) {
		const relation = S.Record.getRelationByKey(it.relationKey);

		if (relation) {
			it.format = relation.format;
			it.includeTime = relation.includeTime;
		};
		return it;
	};

	/**
	 * Maps a filter value template to a value.
	 * @param {string} value - The filter value.
	 * @param {any} [param] - Additional parameters, e.g., rootId.
	 * @returns {string} The mapped value.
	 */
	valueTemplateMapper (value: string, param?: any): string {
		param = param || {};

		const { rootId } = param;
		const { account } = S.Auth;
		const { space } = S.Common;
		const option = Relation.getFilterTemplateOption(value);

		if (!option) {
			return value;
		};

		let r = '';

		switch (option.templateType) {
			default: {
				r = value;
				break;
			};

			case I.FilterValueTemplate.Participant: {
				r = U.Space.getParticipantId(space, account.id);
				break;
			};

			case I.FilterValueTemplate.Object: {
				r = rootId;
				break;
			};
		};

		return r;
	};

	/**
	 * Gets a view object by ID or returns the first available view.
	 * @param {string} rootId - The root object ID.
	 * @param {string} blockId - The block ID.
	 * @param {string} [viewId] - The view ID.
	 * @returns {I.View} The view object.
	 */
	getView (rootId: string, blockId: string, viewId?: string): I.View {
		let view = null;

		if (!viewId) {
			viewId = S.Record.getMeta(S.Record.getSubId(rootId, blockId), '').viewId;
		};

		if (viewId) {
			view = S.Record.getView(rootId, blockId, viewId);
		};

		if (!view) {
			const views = S.Record.getViews(rootId, blockId);
			if (views.length) {
				view = views[0];
			};
		};

		return view;
	};

	/**
	 * Checks if a block is a collection layout.
	 * @param {string} rootId - The root object ID.
	 * @param {string} blockId - The block ID.
	 * @returns {boolean} True if the block is a collection.
	 */
	isCollection (rootId: string, blockId: string): boolean {
		const object = S.Detail.get(rootId, rootId, [ 'layout' ], true);
		const isInline = !U.Object.isInSystemLayouts(object.layout);

		if (!isInline) {
			return U.Object.isCollectionLayout(object.layout);
		};

		const block = S.Block.getLeaf(rootId, blockId);
		if (!block) {
			return false;
		};

		const { targetObjectId, isCollection } = block.content;
		const target = targetObjectId ? S.Detail.get(rootId, targetObjectId, [ 'layout' ], true) : null;

		return target ? U.Object.isCollectionLayout(target.layout) : isCollection;
	};

	/**
	 * Loads the group list for a dataview and updates the store.
	 * @param {string} rootId - The root object ID.
	 * @param {string} blockId - The block ID.
	 * @param {string} viewId - The view ID.
	 * @param {any} object - The object data.
	 */
	loadGroupList (rootId: string, blockId: string, viewId: string, object: any) {
		const view = this.getView(rootId, blockId, viewId);
		const block = S.Block.getLeaf(rootId, blockId);

		if (!view || !block) {
			return;
		};

		const subId = S.Record.getGroupSubId(rootId, block.id, 'groups');
		const isCollection = U.Object.isCollectionLayout(object.layout);

		S.Record.groupsClear(rootId, block.id);

		const relation = S.Record.getRelationByKey(view.groupRelationKey);
		if (!relation) {
			return;
		};

		const groupOrder: any = {};
		const el = block.content.groupOrder.find(it => it.viewId == view.id);
		const filters = this.getFilteredFilters(view.filters).map(it => this.filterMapper(it, { rootId }));

		if (el) {
			el.groups.forEach(it => groupOrder[it.groupId] = it);
		};

		C.ObjectGroupsSubscribe(S.Common.space, subId, view.groupRelationKey, filters, object.setOf || [], isCollection ? object.id : '', (message: any) => {
			if (message.error.code) {
				return;
			};

			const groups = (message.groups || []).map((it: any) => {
				let bgColor = 'grey';
				let value: any = it.value;
				let option: any = null;

				switch (relation.format) {
					case I.RelationType.MultiSelect:
						value = Relation.getArrayValue(value);
						if (value.length) {
							option = S.Detail.get(U.Subscription.spaceSubId(J.Constant.subId.option), value[0]);
							bgColor = option?.color;
						};
						break;

					case I.RelationType.Select:
						option = S.Detail.get(U.Subscription.spaceSubId(J.Constant.subId.option), value);
						bgColor = option?.color;
						break;
				};

				it.isHidden = groupOrder[it.id]?.isHidden;
				it.bgColor = groupOrder[it.id]?.bgColor || bgColor;
				return it;
			});

			S.Record.groupsSet(rootId, block.id, this.applyGroupOrder(rootId, block.id, view.id, groups));
		});
	};

	/**
	 * Gets a filter object for a group relation and value.
	 * @param {any} relation - The relation object.
	 * @param {any} value - The value to filter by.
	 * @returns {I.Filter} The filter object.
	 */
	getGroupFilter (relation: any, value: any): I.Filter {
		const filter: any = { relationKey: relation.relationKey };

		switch (relation.format) {
			default: {
				filter.condition = I.FilterCondition.Equal;
				filter.value = value;
				break;
			};

			case I.RelationType.MultiSelect:
			case I.RelationType.Select: {
				value = Relation.getArrayValue(value);
				const length = value.length;

				filter.condition = length ? I.FilterCondition.ExactIn : I.FilterCondition.Empty;
				filter.value = length ? value : null;
				break;
			};
		};
		return filter;
	};

	/**
	 * Gets the list of groups for a dataview, applying order and visibility.
	 * @param {string} rootId - The root object ID.
	 * @param {string} blockId - The block ID.
	 * @param {string} viewId - The view ID.
	 * @param {boolean} withHidden - Whether to include hidden groups.
	 * @returns {any[]} The list of groups.
	 */
	getGroups (rootId: string, blockId: string, viewId: string, withHidden: boolean) {
		const groups = U.Common.objectCopy(S.Record.getGroups(rootId, blockId));
		const ret = this.applyGroupOrder(rootId, blockId, viewId, groups);

		return !withHidden ? ret.filter(it => !it.isHidden) : ret;
	};

	/**
	 * Updates the group list for a dataview block.
	 * @param {string} rootId - The root object ID.
	 * @param {string} blockId - The block ID.
	 * @param {string} viewId - The view ID.
	 * @param {any[]} groups - The new group list.
	 */
	groupUpdate (rootId: string, blockId: string, viewId: string, groups: any[]) {
		const block = S.Block.getLeaf(rootId, blockId);
		if (!block) {
			return;
		};

		const el = block.content.groupOrder.find(it => it.viewId == viewId);
		if (el) {
			el.groups = groups;
		};

		S.Block.updateContent(rootId, blockId, block.content);
	};

	/**
	 * Updates the group order for a dataview block.
	 * @param {string} rootId - The root object ID.
	 * @param {string} blockId - The block ID.
	 * @param {string} viewId - The view ID.
	 * @param {any[]} groups - The new group order.
	 */
	groupOrderUpdate (rootId: string, blockId: string, viewId: string, groups: any[]) {
		const block = S.Block.getLeaf(rootId, blockId);
		if (!block) {
			return;
		};

		const groupOrder = U.Common.objectCopy(block.content.groupOrder);
		const idx = groupOrder.findIndex(it => it.viewId == viewId);

		if (idx >= 0) {
			groupOrder[idx].groups = groups;
		} else {
			groupOrder.push({ viewId, groups });
		};

		S.Block.updateContent(rootId, blockId, { groupOrder });
	};

	/**
	 * Applies the group order to a list of groups for a dataview.
	 * @param {string} rootId - The root object ID.
	 * @param {string} blockId - The block ID.
	 * @param {string} viewId - The view ID.
	 * @param {any[]} groups - The group list.
	 * @returns {any[]} The ordered group list.
	 */
	applyGroupOrder (rootId: string, blockId: string, viewId: string, groups: any[]) {
		if (!viewId || !groups.length) {
			return groups;
		};

		const block = S.Block.getLeaf(rootId, blockId);
		if (!block) {
			return groups;
		};

		const el = block.content.groupOrder.find(it => it.viewId == viewId);
		const groupOrder: any = {};

		if (el) {
			el.groups.forEach(it => groupOrder[it.groupId] = it);
		};

		groups.sort((c1: any, c2: any) => {
			const idx1 = groupOrder[c1.id]?.index;
			const idx2 = groupOrder[c2.id]?.index;
			if (idx1 > idx2) return 1;
			if (idx1 < idx2) return -1;
			return 0;
		});

		return groups;
	};

	/**
	 * Applies the object order to a list of record IDs for a dataview group.
	 * @param {string} rootId - The root object ID.
	 * @param {string} blockId - The block ID.
	 * @param {string} viewId - The view ID.
	 * @param {string} groupId - The group ID.
	 * @param {string[]} records - The record IDs.
	 * @returns {string[]} The ordered record IDs.
	 */
	applyObjectOrder (rootId: string, blockId: string, viewId: string, groupId: string, records: string[]): string[] {
		records = records || [];

		if (!viewId || !records.length) {
			return records;
		};

		const block = S.Block.getLeaf(rootId, blockId);
		if (!block) {
			return records;
		};

		const el = block.content.objectOrder.find(it => (it.viewId == viewId) && (groupId ? it.groupId == groupId : true));
		if (!el) {
			return records;
		};

		const objectIds = el.objectIds || [];

		records.sort((c1: any, c2: any) => {
			const idx1 = objectIds.indexOf(c1);
			const idx2 = objectIds.indexOf(c2);

			if (idx1 > idx2) return 1;
			if (idx1 < idx2) return -1;
			return 0;
		});

		return records;
	};

	/**
	 * Gets the default view name for a view type.
	 * @param {I.ViewType} type - The view type.
	 * @returns {string} The default view name.
	 */
	defaultViewName (type: I.ViewType): string {
		return translate(`viewName${type}`);
	};

	/**
	 * Gets the details object for a dataview, including group and filter values.
	 * @param {string} rootId - The root object ID.
	 * @param {string} blockId - The block ID.
	 * @param {string} objectId - The object ID.
	 * @param {string} [viewId] - The view ID.
	 * @param {string} [groupId] - The group ID.
	 * @returns {any} The details object.
	 */
	getDetails (rootId: string, blockId: string, objectId: string, viewId?: string, groupId?: string): any {
		const relations = Relation.getSetOfObjects(rootId, objectId, I.ObjectLayout.Relation);
		const view = this.getView(rootId, blockId, viewId);
		const conditions = [
			I.FilterCondition.Equal,
			I.FilterCondition.GreaterOrEqual,
			I.FilterCondition.LessOrEqual,
			I.FilterCondition.In,
			I.FilterCondition.AllIn,
		];
		const details: any = {};
		const hasGroupValue = view.groupRelationKey && [ I.ViewType.Board, I.ViewType.Calendar, I.ViewType.Timeline ].includes(view.type);

		if (relations.length) {
			relations.forEach(it => {
				details[it.relationKey] = Relation.formatValue(it, details[it.relationKey] || null, true);
			});
		};

		if (!view) {
			return details;
		};

		if (hasGroupValue) {
			if (groupId) {
				const group = S.Record.getGroup(rootId, blockId, groupId);
				if (group) {
					details[view.groupRelationKey] = group.value;
				};
			};

			if (view.type == I.ViewType.Calendar) {
				details[view.groupRelationKey] = U.Date.now();
			};

			if (view.type == I.ViewType.Timeline) {
				details[view.groupRelationKey] = U.Date.now();
				details[view.endRelationKey] = U.Date.now() + J.Constant.day * 5;
			};
		};

		const filters = this.flattenFilters(view.filters);

		for (const filter of filters) {
			if (!conditions.includes(filter.condition) || (hasGroupValue && (filter.relationKey == view.groupRelationKey))) {
				continue;
			};

			const relation = S.Record.getRelationByKey(filter.relationKey);
			if (!relation) {
				continue;
			};

			let value = filter.value;

			if (Relation.isArrayType(relation.format)) {
				if (Array.isArray(value)) {
					value = value.map(it => this.valueTemplateMapper(it, { rootId }));
				} else {
					value = this.valueTemplateMapper(value, { rootId });
				};
			};

			if (Relation.isDate(relation.format)) {
				value = Relation.getTimestampForQuickOption(filter.value, filter.quickOption);
			};

			if (!value) {
				continue;
			};

			if (relation && !relation.isReadonlyValue) {
				details[filter.relationKey] = Relation.formatValue(relation, value, true);
			};
		};

		return details;
	};

	flattenFilters (filters: I.Filter[]): I.Filter[] {
		filters = this.getFilteredFilters(filters || []);

		const result: I.Filter[] = [];

		for (const filter of filters) {
			const isAdvanced = (!filter.relationKey && filter.nestedFilters?.length);

			if (isAdvanced) {
				if (filter.operator == I.FilterOperator.And) {
					result.push(...this.flattenFilters(filter.nestedFilters));
				};
			} else {
				result.push(filter);
			};
		};

		return result;
	};

	/**
	 * Gets the type ID for a dataview object, considering view and relations.
	 * @param {string} rootId - The root object ID.
	 * @param {string} blockId - The block ID.
	 * @param {string} objectId - The object ID.
	 * @param {string} [viewId] - The view ID.
	 * @returns {string} The type ID.
	 */
	getTypeId (rootId: string, blockId: string, objectId: string, viewId?: string) {
		const view = this.getView(rootId, blockId, viewId);
		const types = Relation.getSetOfObjects(rootId, objectId, I.ObjectLayout.Type);
		const relations = Relation.getSetOfObjects(rootId, objectId, I.ObjectLayout.Relation);
		const object = S.Detail.get(rootId, rootId, [ 'type' ], true);
		const type = S.Record.getTypeById(object.type);
		const isAllowedDefaultType = this.isCollection(rootId, blockId) || !!relations.length;

		let typeId = '';
		if (view && view.defaultTypeId && isAllowedDefaultType) {
			typeId = view.defaultTypeId;
		} else
		if (types.length) {
			typeId = types[0].id;
		} else
		if (relations.length) {
			for (const item of relations) {
				const objectTypes = Relation.getArrayValue(item.objectTypes);

				if (!objectTypes.length) {
					continue;
				};

				const first = S.Record.getTypeById(objectTypes[0]);
				if (first && !U.Object.isInFileOrSystemLayouts(first.recommendedLayout)) {
					typeId = first.id;
					break;
				};
			};
		};

		if (!typeId && type && type.defaultTypeId) {
			typeId = type.defaultTypeId;
		};

		const check = S.Record.getTypeById(typeId);
		if (!check) {
			typeId = S.Common.type;
		};

		return typeId;
	};

	/**
	 * Gets the tooltip text for creating a new object in a dataview.
	 * @param {string} rootId - The root object ID.
	 * @param {string} blockId - The block ID.
	 * @param {string} objectId - The object ID.
	 * @param {string} viewId - The view ID.
	 * @returns {string} The tooltip text.
	 */
	getCreateTooltip (rootId: string, blockId: string, objectId: string, viewId: string): string {
		const isCollection = this.isCollection(rootId, blockId);

		if (isCollection) {
			return translate('blockDataviewCreateNewTooltipCollection');
		} else {
			const typeId = this.getTypeId(rootId, blockId, objectId, viewId);
			const type = S.Record.getTypeById(typeId);

			if (type) {
				return U.String.sprintf(translate('blockDataviewCreateNewTooltipType'), type.name);
			};
		};
		return translate('commonCreateNewObject');
	};

	/**
	 * Updates a dataview view with new parameters.
	 * @param {string} rootId - The root object ID.
	 * @param {string} blockId - The block ID.
	 * @param {string} viewId - The view ID.
	 * @param {Partial<I.View>} param - The parameters to update.
	 * @param {function} [callBack] - Optional callback after update.
	 */
	viewUpdate (rootId: string, blockId: string, viewId: string, param: Partial<I.View>, callBack?: (message: any) => void) {
		const view = U.Common.objectCopy(S.Record.getView(rootId, blockId, viewId));
		if (view && view.id) {
			C.BlockDataviewViewUpdate(rootId, blockId, view.id, Object.assign(view, param), callBack);
		};
	};

	/**
	 * Duplicates an existing view in a dataview block, preserving its configuration and optionally its group order.
	 * @param {string} rootId - The root object ID.
	 * @param {string} blockId - The block ID.
	 * @param {I.View} view - The view object to duplicate.
	 * @param {string[]} sources - The source object IDs for the duplicated view.
	 * @param {function} [callBack] - Optional callback after duplication.
	 */
	duplicateView (
		rootId: string,
		blockId: string,
		view: I.View,
		sources: string[],
		callBack?: (message: any) => void,
	) {
		const block = S.Block.getLeaf(rootId, blockId);
		if (!block || !view) {
			return;
		};

		const sourceOrder = (block.content.groupOrder || []).find(it => it.viewId == view.id);

		C.BlockDataviewViewCreate(rootId, blockId, { ...view }, sources, (message: any) => {
			if (message.error?.code) {
				callBack?.(message);
				return;
			};

			if (sourceOrder) {
				const groupsCopy = (sourceOrder.groups || []).map((it: any) => ({ ...it }));

				this.groupOrderUpdate(rootId, blockId, message.viewId, groupsCopy);
				C.BlockDataviewGroupOrderUpdate(rootId, blockId, { viewId: message.viewId, groups: groupsCopy });
			};

			callBack?.(message);
		});
	};

	/**
	 * Gets the cover object for a dataview relation.
	 * @param {string} subId - The subscription ID.
	 * @param {any} object - The object data.
	 * @param {string} relationKey - The relation key.
	 * @returns {any} The cover object.
	 */
	getCoverObject (subId: string, object: any, relationKey: string): any {
		if (!relationKey) {
			return null;
		};

		const value = Relation.getArrayValue(object[relationKey]);
		const layouts = [
			I.ObjectLayout.Image,
			I.ObjectLayout.Audio,
			I.ObjectLayout.Video,
		];

		let ret = null;
		if (relationKey == J.Relation.pageCover) {
			ret = object;
		} else {
			for (const id of value) {
				const file = S.Detail.get(subId, id, []);
				if (file._empty_ || !layouts.includes(file.layout)) {
					continue;
				};

				ret = file;
				break;
			};
		};

		if (!ret || ret._empty_) {
			return null;
		};

		if (!ret.coverId && !ret.coverType && !layouts.includes(ret.layout)) {
			return null;
		};

		return ret;
	};

	/**
	 * Gets the result of a formula for a dataview relation.
	 * @param {string} subId - The subscription ID.
	 * @param {I.ViewRelation} viewRelation - The view relation.
	 * @returns {any} The formula result.
	 */
	getFormulaResult (subId: string, viewRelation: I.ViewRelation): any {
		if (!viewRelation) {
			return null;
		};

		const { showRelativeDates } = S.Common;
		const { formulaType, relationKey } = viewRelation;
		const relation = S.Record.getRelationByKey(relationKey);

		if (!relation) {
			return null;
		};

		const { total } = S.Record.getMeta(subId, '');
		const isDate = relation.format == I.RelationType.Date;
		const isArray = Relation.isArrayType(relation.format);
		const needRecords = ![ I.FormulaType.None, I.FormulaType.Count ].includes(formulaType);
		const records = needRecords ? S.Record.getRecords(subId, [ relationKey ], true) : [];

		const date = (t: number) => {
			const day = showRelativeDates ? U.Date.dayString(t) : null;
			const date = day ? day : U.Date.dateWithFormat(S.Common.dateFormat, t);
			const time = U.Date.timeWithFormat(S.Common.timeFormat, t);

			return relation.includeTime ? [ date, time ].join(' ') : date;
		};

		const min = () => {
			const map = records.map(it => it[relationKey]).filter(it => !Relation.isEmpty(it));
			return map.length ? Math.min(...map.map(it => Number(it || 0))) : null;
		};
		const max = () => {
			const map = records.map(it => it[relationKey]).filter(it => !Relation.isEmpty(it));
			return map.length ? Math.max(...map.map(it => Number(it || 0))) : null;
		};
		const float = (v: any): string => {
			if (v === null) {
				return null;
			};

			const mapped = Relation.mapValue(relation, v);
			if (mapped !== null) {
				return mapped;
			};

			return U.Common.formatNumber(U.Common.round(v, 3));
		};
		const filtered = (filterEmpty: boolean) => {
			return records.filter(it => {
				let isEmpty = false;
				if (relationKey == 'name') {
					isEmpty = Relation.isEmpty(it[relationKey]) || (it[relationKey] == translate('defaultNamePage'));
				} else {
					isEmpty = relation.format == I.RelationType.Checkbox ? !it[relationKey] : Relation.isEmpty(it[relationKey]);
				};
				return filterEmpty == isEmpty;
			});
		};

		let ret = null;

		switch (formulaType) {
			case I.FormulaType.None: {
				break;
			};

			case I.FormulaType.Count: {
				ret = float(total);
				break;
			};

			case I.FormulaType.CountValue: {
				const items = filtered(false);

				if (isArray || isDate) {
					const values = new Set();

					items.forEach(it => {
						values.add(isDate ? 
							date(it[relationKey]) : 
							Relation.getArrayValue(it[relationKey]).sort().join(', ')
						);
					});

					ret = values.size;
				} else {
					ret = U.Common.arrayUniqueObjects(items, relationKey).length;
				};
				ret = float(ret);
				break;
			};

			case I.FormulaType.CountDistinct: {
				const items = filtered(false);

				if (isArray || isDate) {
					const values = new Set();

					items.forEach(it => {
						if (isDate) {
							values.add(date(it[relationKey]));
						} else {
							Relation.getArrayValue(it[relationKey]).forEach(v => values.add(v));
						};
					});

					ret = values.size;
				} else {
					ret = U.Common.arrayUniqueObjects(items, relationKey).length;
				};
				ret = float(ret);
				break;
			};

			case I.FormulaType.CountEmpty: {
				ret = float(filtered(true).length);
				break;
			};

			case I.FormulaType.CountNotEmpty: {
				ret = float(filtered(false).length);
				break;
			};

			case I.FormulaType.PercentEmpty: {
				ret = float(filtered(true).length / total * 100) + '%';
				break;
			};

			case I.FormulaType.PercentNotEmpty: {
				ret = float(filtered(false).length / total * 100) + '%';
				break;
			};

			case I.FormulaType.MathSum: {
				ret = float(records.reduce((acc, it) => acc + (Number(it[relationKey]) || 0), 0));
				break;
			};

			case I.FormulaType.MathAverage: {
				ret = float(records.reduce((acc, it) => acc + (Number(it[relationKey]) || 0), 0) / total);
				break;
			};

			case I.FormulaType.MathMedian: {
				const data = records.map(it => Number(it[relationKey]) || 0);
				const n = data.length;

				data.sort((a, b) => a - b);
    
				if (n % 2 == 1) {
					ret = data[Math.floor(n / 2)];
				} else {
					ret = (data[n / 2 - 1] + data[n / 2]) / 2;
				};

				ret = float(ret);
				break;
			};

			case I.FormulaType.MathMin: {
				ret = min();
				if (isDate) {
					ret = ret ? date(ret) : '';
				} else {
					ret = float(ret);
				};
				break;
			};

			case I.FormulaType.MathMax: {
				ret = max();
				if (isDate) {
					ret = ret ? date(ret) : '';
				} else {
					ret = float(ret);
				};
				break;
			};

			case I.FormulaType.Range: {
				if (isDate) {
					ret = U.Date.duration(max() - min());
				} else {
					ret = float(max() - min());
				};
				break;
			};
		};

		return ret;
	};

	/**
	 * Creates default filter values from a relation item.
	 * @param {any} relation - The relation item (must have format).
	 * @returns {object} The default filter values with condition, value, and quickOption.
	 */
	getDefaultFilterValues (relation: any): { condition: I.FilterCondition; value: any; quickOption: I.FilterQuickOption } {
		const conditions = Relation.filterConditionsByType(relation.format);
		const condition = conditions.length ? conditions[0].id : I.FilterCondition.None;
		const quickOption = this.getDefaultQuickOption(relation);

		return {
			condition: condition as I.FilterCondition,
			value: Relation.formatValue(relation, null, false),
			quickOption,
		};
	};

	/**
	 * Returns default quick option for filter item.
	 * @param {any} item - The relation item (must have format).
	 * @returns {I.FilterQuickOption} The default quick option for filter item.
	 */
	getDefaultQuickOption (item: any): I.FilterQuickOption {
		const conditions = Relation.filterConditionsByType(item.format);
		const condition = conditions.length ? conditions[0].id : I.FilterCondition.None;
		const quickOptions = Relation.filterQuickOptions(item.format, condition);

		if (!quickOptions.length || quickOptions.find(it => it.id == I.FilterQuickOption.ExactDate)) {
			return I.FilterQuickOption.ExactDate;
		};

		return quickOptions[0].id;
	};

	/**
	 * Checks if a filter is an advanced filter (has And/Or operator).
	 * @param {I.Filter} filter - The filter to check.
	 * @returns {boolean} True if the filter is advanced.
	 */
	isAdvancedFilter (filter: I.Filter): boolean {
		return [ I.FilterOperator.And, I.FilterOperator.Or ].includes(filter.operator);
	};

	/**
	 * Creates default advanced filter object with nested filters.
	 * @returns {Partial<I.Filter>} The default advanced filter configuration.
	 */
	getDefaultAdvancedFilter (): Partial<I.Filter> {
		return {
			operator: I.FilterOperator.And,
			condition: I.FilterCondition.None,
			relationKey: '',
			value: '',
			nestedFilters: [
				{
					relationKey: 'name',
					condition: I.FilterCondition.Like,
					value: '',
				}
			],
		};
	};

	checkDeletedRelation (relationKey: string): boolean {
		const relation = S.Record.getRelationByKey(relationKey);
		return relation && !relation.isDeleted && !relation.isArchived;
	};

	getFilteredFilters (filters: I.Filter[]): I.Filter[] {
		return (filters || []).filter(it => it && (this.isAdvancedFilter(it) || this.checkDeletedRelation(it.relationKey)));
	};

	getFilteredSorts (sorts: I.Sort[]): I.Sort[] {
		return (sorts || []).filter(it => it && this.checkDeletedRelation(it.relationKey));
	};

	/**
	 * Clears a filter to its default values.
	 * @param {string} rootId - The root object ID.
	 * @param {string} blockId - The block ID.
	 * @param {string} viewId - The view ID.
	 * @param {I.Filter} filter - The filter to clear.
	 * @param {function} [callBack] - Optional callback after clearing.
	 */
	clearFilter (rootId: string, blockId: string, viewId: string, filter: I.Filter, callBack?: () => void) {
		const isAdvanced = this.isAdvancedFilter(filter);

		let updatedFilter: any;

		if (isAdvanced) {
			updatedFilter = {
				...filter,
				...this.getDefaultAdvancedFilter(),
			};
		} else {
			const relation = S.Record.getRelationByKey(filter.relationKey);
			if (!relation) {
				return;
			};
			updatedFilter = {
				...filter,
				...this.getDefaultFilterValues(relation),
			};
		};

		C.BlockDataviewFilterReplace(rootId, blockId, viewId, filter.id, updatedFilter, callBack);
	};

	/**
	 * Adds a filter to a dataview.
	 * @param {string} rootId - The root object ID.
	 * @param {string} blockId - The block ID.
	 * @param {string} viewId - The view ID.
	 * @param {any} filter - The filter to add.
	 * @param {function} [callBack] - Optional callback after adding.
	 */
	addFilter (rootId: string, blockId: string, viewId: string, filter: any, callBack?: (message: any) => void) {
		Storage.toggleViewFilter(rootId, viewId, true);

		C.BlockDataviewFilterAdd(rootId, blockId, viewId, filter, callBack);
	};

	/**
	 * Gets the placeholder name for a given layout type.
	 * @param {I.ObjectLayout} layout - The layout type.
	 * @returns {string} The placeholder name.
	 */
	namePlaceholder (layout: I.ObjectLayout): string {
		let ret = '';
		if (U.Object.isCollectionLayout(layout)) {
			ret = translate('defaultNameCollection');
		} else 
		if (U.Object.isTypeLayout(layout)) {
			ret = translate('defaultNameType');
		} else 
		if (U.Object.isSetLayout(layout)) {
			ret = translate('defaultNameSet');
		};
		return ret;
	};

	/**
	 * Adds a type or dataview relation to a block and updates the view.
	 * @param {string} rootId - The root object ID.
	 * @param {string} blockId - The block ID.
	 * @param {any} relation - The relation object.
	 * @param {any} object - The object data.
	 * @param {I.View} view - The dataview view object.
	 * @param {number} index - The index to insert at.
	 * @param {function} [callBack] - Optional callback after addition.
	 */
	addTypeOrDataviewRelation (rootId: string, blockId: string, relation: any, object: any, view: I.View, index: number, callBack?: (message: any) => void) {
		if (!rootId || !blockId || !relation || !object || !view) {
			return;
		};

		const isType = U.Object.isTypeLayout(object.layout);

		if (isType) {
			const value = U.Common.arrayUnique(Relation.getArrayValue(object.recommendedRelations).concat(relation.id));

			C.ObjectListSetDetails([ object.id ], [ { key: 'recommendedRelations', value } ], (message: any) => {
				if (message.error.code) {
					return;
				};

				S.Detail.update(U.Subscription.spaceSubId(J.Constant.subId.type), { id: rootId, details: { recommendedRelations: value } }, false);
				C.BlockDataviewRelationSet(rootId, J.Constant.blockId.dataview, [ 'name', 'description' ].concat(U.Object.getTypeRelationKeys(rootId)), () => {
					this.viewRelationAdd(rootId, blockId, relation.relationKey, index, view, callBack);
				});
			});
		} else {
			this.relationAdd(rootId, blockId, relation.relationKey, index, view, callBack);
		};
	};

	/**
	 * Splits text copied from a spreadsheet into rows of cells. Cells are separated by tabs,
	 * and a cell with tabs, line breaks or quotes is quoted, as Excel and Google Sheets copy them.
	 * @param {string} text - The copied text.
	 * @returns {string[][]} The non-empty rows.
	 */
	pasteParse (text: string): string[][] {
		const rows: string[][] = [];

		let row: string[] = [];
		let cell = '';
		let quoted = false;

		text = String(text || '').replace(/\r\n?/g, '\n');

		for (let i = 0; i < text.length; i++) {
			const c = text[i];

			if (quoted) {
				if (c != '"') {
					cell += c;
				} else
				if (text[i + 1] == '"') {
					cell += '"';
					i++;
				} else {
					quoted = false;
				};
				continue;
			};

			if ((c == '"') && !cell.length) {
				quoted = true;
				continue;
			};

			if ((c == '\t') || (c == '\n')) {
				row.push(cell.trim());
				cell = '';

				if (c == '\n') {
					rows.push(row);
					row = [];
				};
				continue;
			};

			cell += c;
		};

		if (cell.length || row.length) {
			row.push(cell.trim());
			rows.push(row);
		};

		return rows.filter(it => it.some(c => c.length));
	};

	/**
	 * Matches the header row of pasted rows to properties. The Name column fills the object name, and the
	 * Código (or Code, ID) column is the key that finds objects to update instead of creating them.
	 * @param {string[]} header - The first pasted row.
	 * @returns {any} The property of each column (null when unknown), the key column index, whether the key
	 * column has no property yet (it is created on import) and the unknown names.
	 */
	pastePlan (header: string[]): { relations: any[]; keyIndex: number; missingKey: boolean; unknown: string[] } {
		const normalize = (v: string) => String(v || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
		const relations = S.Record.getRelations();
		const nameKeys = [ 'nombre', 'name', normalize(S.Record.getRelationByKey('name')?.name) ];
		const keyNames = [ 'codigo', 'code', 'id' ];
		const unknown: string[] = [];
		const skip = [ I.RelationType.Object, I.RelationType.File, I.RelationType.Formula, I.RelationType.Relations ];

		let keyIndex = -1;

		const columns = header.map((name, i) => {
			const n = normalize(name);

			let relation = null;
			if (nameKeys.includes(n)) {
				relation = S.Record.getRelationByKey('name');
			} else {
				relation = relations.find(it => !it.isReadonlyValue && !skip.includes(it.relationFormat) && (normalize(it.name) == n));
			};

			if (keyNames.includes(n) && (keyIndex < 0)) {
				keyIndex = i;
			};

			if (!relation && (keyIndex != i)) {
				unknown.push(name);
			};
			return relation;
		});

		return { relations: columns, keyIndex, missingKey: (keyIndex >= 0) && !columns[keyIndex], unknown };
	};

	/**
	 * Converts a pasted cell to the value of a property. Option names are kept as names and resolved on import.
	 * @param {any} relation - The property.
	 * @param {string} text - The cell.
	 * @returns {any} The value, or null when the cell is empty or does not fit the property.
	 */
	pasteValue (relation: any, text: string): any {
		text = String(text || '').trim();
		if (!text) {
			return null;
		};

		switch (relation.format) {
			case I.RelationType.Number: {
				let v = text.replace(/\s/g, '');

				// 1.234,5 is a decimal comma with thousands dots, 1,234.5 the other way round
				if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(v) || /^-?\d+,\d+$/.test(v)) {
					v = v.replace(/\./g, '').replace(',', '.');
				} else {
					v = v.replace(/,/g, '');
				};

				const n = Number(v);
				return isNaN(n) ? null : n;
			};

			case I.RelationType.Checkbox: {
				return /^(1|x|si|sí|yes|true|verdadero|✓|✔)$/i.test(text);
			};

			case I.RelationType.Date: {
				let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
				if (m) {
					return U.Date.timestamp(Number(m[1]), Number(m[2]), Number(m[3]));
				};

				m = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
				if (m) {
					const y = Number(m[3]);
					return U.Date.timestamp((y < 100) ? (2000 + y) : y, Number(m[2]), Number(m[1]));
				};
				return null;
			};

			case I.RelationType.Select: {
				return [ text ];
			};

			case I.RelationType.MultiSelect: {
				return text.split(/[,;]/).map(it => it.trim()).filter(it => it);
			};

			default: {
				return text;
			};
		};
	};

	/**
	 * Imports pasted rows into a dataview: rows whose key matches an object of the type update it, the rest
	 * create objects with the view defaults (for example the project the view is filtered by).
	 * Keys are matched only among objects that link to the same objects as the view defaults, so the same
	 * code can be used in two projects. A key column without a property creates it as text, adds it to the
	 * type and shows it in the view. Empty cells leave the value as it is.
	 * @param {string[][]} rows - The pasted rows, the first one with property names.
	 * @param {any} param - typeId, templateId, the details of new objects, the collection to add them to,
	 * and the dataview (rootId, blockId, view) that shows a created key property.
	 * @param {function} callBack - Gets the number of updated and created objects.
	 */
	async pasteImport (rows: string[][], param: { typeId: string; templateId?: string; details?: any; collectionId?: string; rootId?: string; blockId?: string; view?: I.View }, callBack?: (updated: number, created: number) => void) {
		const [ header, ...data ] = rows;
		const { relations, keyIndex, missingKey } = this.pastePlan(header || []);
		const type = S.Record.getTypeById(param.typeId);
		const space = S.Common.space;
		const call = (fn: any, ...args: any[]): Promise<any> => new Promise(resolve => fn(...args, resolve));

		if (!type || !data.length) {
			callBack?.(0, 0);
			return;
		};

		// option names to ids, creating the missing options
		const optionIds = async (relation: any, names: string[]) => {
			const message = await call(C.ObjectSearch, space, [
				{ relationKey: 'relationKey', condition: I.FilterCondition.Equal, value: relation.relationKey },
				{ relationKey: 'resolvedLayout', condition: I.FilterCondition.Equal, value: I.ObjectLayout.Option },
			], [], [ 'id', 'name' ], '', 0, 0);
			const options = message.records || [];
			const ids: string[] = [];

			for (const name of names) {
				let option = options.find(it => String(it.name).toLowerCase() == name.toLowerCase());
				if (!option) {
					const created = await call(C.ObjectCreateRelationOption, { relationKey: relation.relationKey, name, relationOptionColor: '' }, space);
					option = created.details;
					options.push(option);
				};
				if (option?.id) {
					ids.push(option.id);
				};
			};
			return ids;
		};

		if (missingKey) {
			const message = await call(C.ObjectCreateRelation, { name: header[keyIndex], relationFormat: I.RelationType.ShortText }, space);
			if (message.error?.code || !message.details) {
				callBack?.(0, 0);
				return;
			};

			const relation = message.details;
			const recommended = U.Common.arrayUnique(Relation.getArrayValue(type.recommendedRelations).concat(relation.id));

			S.Detail.update(U.Subscription.spaceSubId(J.Constant.subId.relation), { id: relation.id, details: relation }, false);
			await call(C.ObjectListSetDetails, [ type.id ], [ { key: 'recommendedRelations', value: recommended } ]);

			if (param.rootId && param.blockId && param.view) {
				this.relationAdd(param.rootId, param.blockId, relation.relationKey, -1, param.view);
			};

			relations[keyIndex] = S.Record.getRelationById(relation.id) || { ...relation, format: I.RelationType.ShortText };
		};

		// the projects (or other objects) the view puts new rows in
		const scope: I.Filter[] = [];
		for (const key in (param.details || {})) {
			const value = Relation.getArrayValue(param.details[key]);
			if ((S.Record.getRelationByKey(key)?.format == I.RelationType.Object) && value.length) {
				scope.push({ relationKey: key, condition: I.FilterCondition.In, value } as I.Filter);
			};
		};

		const existing: Map<string, string> = new Map();
		if ((keyIndex >= 0) && !missingKey) {
			const keyRelation = relations[keyIndex];
			const codes = data.map(it => it[keyIndex]).filter(it => it);
			const message = await call(C.ObjectSearch, space, [
				{ relationKey: 'type', condition: I.FilterCondition.Equal, value: type.id },
				{ relationKey: keyRelation.relationKey, condition: I.FilterCondition.In, value: codes },
				...scope,
			], [], [ 'id', keyRelation.relationKey ], '', 0, 0);

			for (const record of (message.records || [])) {
				existing.set(String(record[keyRelation.relationKey]), record.id);
			};
		};

		let updated = 0;
		const createdIds: string[] = [];

		for (const row of data) {
			const details: any = {};

			for (let i = 0; i < relations.length; i++) {
				const relation = relations[i];
				if (!relation) {
					continue;
				};

				let value = this.pasteValue(relation, row[i]);
				if ((value === null) || (value === undefined)) {
					continue;
				};

				if ([ I.RelationType.Select, I.RelationType.MultiSelect ].includes(relation.format)) {
					value = await optionIds(relation, value);
				};
				details[relation.relationKey] = value;
			};

			const id = (keyIndex >= 0) ? existing.get(row[keyIndex]) : '';
			if (id) {
				await call(C.ObjectListSetDetails, [ id ], Object.keys(details).map(key => ({ key, value: details[key] })));
				updated++;
				continue;
			};

			const message = await call(C.ObjectCreate, { ...(param.details || {}), ...details }, [], param.templateId || '', type.uniqueKey, space);
			if (message.objectId) {
				createdIds.push(message.objectId);

				if (keyIndex >= 0) {
					existing.set(row[keyIndex], message.objectId);
				};
			};
		};

		if (param.collectionId && createdIds.length) {
			Action.addToCollection(param.collectionId, createdIds);
		};

		callBack?.(updated, createdIds.length);
	};

};

export default new Dataview();
