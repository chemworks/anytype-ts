import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { Textarea } from 'Component';

interface Props {
	relation: any;
	readonly?: boolean;
	onChange?(): void;
	onMouseEnter?(e: any): void;
};

export interface RelationFormulaRefProps {
	/** Returns the formula as typed, or an empty string. */
	getValue(): string;
	/** Returns the formula with property names rewritten to relation keys, as it is stored. */
	getStorageValue(): string;
};

// Shows whether the stored formula compiles and the format of its value, as the middleware reports them
const FormulaStatus = observer(({ relationId }: { relationId: string }) => {
	const relation = relationId ? S.Record.getRelationById(relationId) : null;

	if (!relation || !relation.isFormula || !relation.relationFormula) {
		return <div className="formulaStatus">{translate('menuDataviewRelationEditFormulaHint')}</div>;
	};

	if (relation.relationFormulaError) {
		return <div className="formulaStatus isError">{relation.relationFormulaError}</div>;
	};

	const resultName = translate(`relationName${relation.relationFormulaResultFormat}`);
	return <div className="formulaStatus">{U.String.sprintf(translate('menuDataviewRelationEditFormulaResult'), resultName)}</div>;
});

const RelationFormula = forwardRef<RelationFormulaRefProps, Props>(({ relation, readonly, onChange, onMouseEnter }, ref) => {
	const value = relation?.isFormula ? Relation.formulaToDisplay(relation.relationFormula) : '';
	// Textarea updates its own value after onChange, so the last typed value is kept here
	const valueRef = useRef(value);
	const getValue = () => String(valueRef.current || '').trim();

	const onChangeHandler = (e: any, v: string) => {
		valueRef.current = v;
		onChange?.();
	};

	useImperativeHandle(ref, () => ({
		getValue,
		getStorageValue: () => Relation.formulaToStorage(getValue()),
	}));

	return (
		<div className="section" onMouseEnter={onMouseEnter}>
			<div className="name">{translate('menuDataviewRelationEditFormula')}</div>
			<div className="inputWrap">
				<Textarea
					className="formula"
					value={value}
					placeholder={translate('menuDataviewRelationEditFormulaPlaceholder')}
					rows={3}
					readonly={readonly}
					onChange={onChangeHandler}
				/>
			</div>
			<FormulaStatus relationId={relation?.id} />
		</div>
	);
});

export default RelationFormula;
