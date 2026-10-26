import React, { forwardRef, useEffect, useRef, useState } from 'react';
import { Textarea, Button } from 'Component';
import * as I from 'Interface';

const MenuDataviewPaste = forwardRef<I.MenuRef, I.Menu>((props, ref) => {

	const { param, position, close } = props;
	const { data } = param;
	const { rootId, blockId, getView, typeId, templateId, getDetails, isCollection, targetId } = data;
	const valueRef = useRef('');
	const [ rows, setRows ] = useState<string[][]>([]);
	const [ isLoading, setIsLoading ] = useState(false);
	const [ result, setResult ] = useState('');
	const [ match, setMatch ] = useState<{ update: number; create: number }>(null);
	const requestRef = useRef(0);

	useEffect(() => {
		position();
	});

	// how many rows update an object and how many create one, refreshed when the pasted text changes
	useEffect(() => {
		const plan = (rows.length > 1) ? Dataview.pastePlan(rows[0]) : null;
		const request = ++requestRef.current;

		setMatch(null);
		if (!plan || (plan.keyIndex < 0)) {
			return;
		};

		const codes = rows.slice(1).map(it => Dataview.pasteKey(it[plan.keyIndex]));
		const count = (existing: Map<string, string>) => {
			const seen = new Set<string>();

			let update = 0;
			for (const code of codes) {
				if (code && (existing.has(code) || seen.has(code))) {
					update++;
				};
				seen.add(code);
			};
			return { update, create: codes.length - update };
		};

		if (plan.missingKey) {
			setMatch(count(new Map()));
			return;
		};

		Dataview.pasteMatch(plan.relations[plan.keyIndex], typeId, getDetails?.() || {}).then(existing => {
			if (request == requestRef.current) {
				setMatch(count(existing));
			};
		});
	}, [ rows ]);

	const onChange = (e: any, v: string) => {
		valueRef.current = v;
		setRows(Dataview.pasteParse(v));
		setResult('');
	};

	const onImport = () => {
		if (isLoading || (rows.length < 2)) {
			return;
		};

		setIsLoading(true);
		Dataview.pasteImport(rows, {
			typeId,
			templateId,
			details: getDetails?.() || {},
			collectionId: isCollection ? targetId : '',
			rootId,
			blockId,
			view: getView?.(),
		}, (updated: number, created: number) => {
			setIsLoading(false);
			setResult(U.String.sprintf(translate('menuDataviewPasteResult'), updated, created));
			window.setTimeout(() => close(), 1500);
		});
	};

	const plan = rows.length ? Dataview.pastePlan(rows[0]) : null;
	const lines: string[] = [];

	if (plan) {
		const known = plan.relations.filter(it => it).map(it => it.name);

		lines.push(U.String.sprintf(translate('menuDataviewPasteRows'), rows.length - 1, known.join(', ')));
		if (plan.missingKey) {
			lines.push(U.String.sprintf(translate('menuDataviewPasteKeyNew'), rows[0][plan.keyIndex]));
		} else {
			lines.push((plan.keyIndex >= 0) ? U.String.sprintf(translate('menuDataviewPasteKey'), rows[0][plan.keyIndex]) : translate('menuDataviewPasteNoKey'));
		};

		if (match) {
			lines.push(U.String.sprintf(translate('menuDataviewPasteMatch'), match.update, match.create));
		};

		if (plan.keyIndex >= 0) {
			const codes = rows.slice(1).map(it => Dataview.pasteKey(it[plan.keyIndex])).filter(it => it);
			const repeated = U.Common.arrayUnique(codes.filter((it, i) => codes.indexOf(it) != i));

			if (repeated.length) {
				lines.push(U.String.sprintf(translate('menuDataviewPasteRepeated'), repeated.join(', ')));
			};
		};

		const invalid: string[] = [];
		plan.relations.forEach((relation, i) => {
			if (!relation) {
				return;
			};

			const n = rows.slice(1).filter(it => Dataview.pasteValue(relation, it[i]) === undefined).length;
			if (n) {
				invalid.push(`${relation.name} (${n})`);
			};
		});

		if (invalid.length) {
			lines.push(U.String.sprintf(translate('menuDataviewPasteInvalid'), invalid.join(', ')));
		};

		if (plan.unknown.length) {
			lines.push(U.String.sprintf(translate('menuDataviewPasteUnknown'), plan.unknown.join(', ')));
		};
	};

	const canImport = !isLoading && (rows.length >= 2);

	return (
		<div className="form">
			<div className="section">
				<div className="name">{translate('menuDataviewPasteTitle')}</div>
				<div className="inputWrap">
					<Textarea
						className="formula"
						placeholder={translate('menuDataviewPastePlaceholder')}
						rows={6}
						onChange={onChange}
					/>
				</div>
				{lines.map((line, i) => <div key={i} className="formulaStatus">{line}</div>)}
				{result ? <div className="formulaStatus">{result}</div> : ''}
			</div>
			<div className="section">
				<div className="inputWrap">
					<Button
						text={translate('menuDataviewPasteImport')}
						color={canImport ? 'accent' : 'blank'}
						size={28}
						onClick={onImport}
					/>
				</div>
			</div>
		</div>
	);

});

export default MenuDataviewPaste;
