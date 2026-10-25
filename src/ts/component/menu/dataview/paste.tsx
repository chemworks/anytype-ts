import React, { forwardRef, useEffect, useRef, useState } from 'react';
import { Textarea, Button } from 'Component';
import * as I from 'Interface';

const MenuDataviewPaste = forwardRef<I.MenuRef, I.Menu>((props, ref) => {

	const { param, position, close } = props;
	const { data } = param;
	const { typeId, templateId, getDetails, isCollection, targetId } = data;
	const valueRef = useRef('');
	const [ rows, setRows ] = useState<string[][]>([]);
	const [ isLoading, setIsLoading ] = useState(false);
	const [ result, setResult ] = useState('');

	useEffect(() => {
		position();
	});

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
		lines.push((plan.keyIndex >= 0) ? U.String.sprintf(translate('menuDataviewPasteKey'), rows[0][plan.keyIndex]) : translate('menuDataviewPasteNoKey'));

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
