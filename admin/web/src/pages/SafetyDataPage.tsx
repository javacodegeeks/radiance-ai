import { useState } from 'react';
import { useApiClient } from '../lib/apiClient';
import { PaginatedList } from '../components/PaginatedList';
import {
  IngredientRecord, CosingFunctionRecord, ProhibitedSubstanceRecord, RestrictionRecord, SafetyRuleRecord,
} from '../types';

type Tab = 'ingredients' | 'functions' | 'prohibited' | 'restrictions' | 'rules';

const TABS: { id: Tab; label: string }[] = [
  { id: 'ingredients', label: 'Ingredients' },
  { id: 'functions', label: 'CosIng Functions' },
  { id: 'prohibited', label: 'Prohibited Substances' },
  { id: 'restrictions', label: 'Restrictions' },
  { id: 'rules', label: 'Safety Rules' },
];

export function SafetyDataPage() {
  const api = useApiClient();
  const [tab, setTab] = useState<Tab>('ingredients');

  return (
    <section>
      <h1>Safety Data</h1>
      <p className="page-subtitle">Read-only EU CosIng / ingredient safety reference data.</p>

      <nav className="tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            className={t.id === tab ? 'tab tab-active' : 'tab'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'ingredients' && (
        <PaginatedList<IngredientRecord>
          key="ingredients"
          fetchPage={api.listIngredients}
          getKey={i => i.id}
          searchPlaceholder="Search by INCI, common, or chemical name…"
          columns={[
            { header: 'INCI Name', render: i => i.inci_name },
            { header: 'Common Name', render: i => i.common_glossary_name },
            { header: 'Chemical Name', render: i => i.chemical_name ?? '—' },
            { header: 'EC No.', render: i => i.ec_no ?? '—' },
            { header: 'Status', render: i => i.status },
          ]}
        />
      )}

      {tab === 'functions' && (
        <PaginatedList<CosingFunctionRecord>
          key="functions"
          fetchPage={api.listCosingFunctions}
          getKey={f => f.id}
          searchPlaceholder="Search by function name…"
          columns={[
            { header: 'Function', render: f => f.function_name },
            { header: 'Description', render: f => f.function_description ?? '—' },
          ]}
        />
      )}

      {tab === 'prohibited' && (
        <PaginatedList<ProhibitedSubstanceRecord>
          key="prohibited"
          fetchPage={api.listProhibitedSubstances}
          getKey={p => p.id}
          searchPlaceholder="Search by ingredient or reference number…"
          columns={[
            { header: 'Ingredient', render: p => p.ingredient },
            { header: 'Reference No.', render: p => p.reference_number },
            { header: 'Regulation', render: p => p.regulation ?? '—' },
            { header: 'CMR', render: p => p.cmr ?? '—' },
          ]}
        />
      )}

      {tab === 'restrictions' && (
        <PaginatedList<RestrictionRecord>
          key="restrictions"
          fetchPage={api.listRestrictions}
          getKey={r => r.id}
          searchPlaceholder="Search by ingredient or reference number…"
          columns={[
            { header: 'Ingredient', render: r => r.ingredient },
            { header: 'Annex', render: r => r.annex },
            { header: 'Reference No.', render: r => r.reference_number },
            { header: 'Max Concentration', render: r => r.max_concentration ?? '—' },
            { header: 'Conditions', render: r => r.conditions_text ?? '—' },
            { header: 'Regulation', render: r => r.regulation ?? '—' },
          ]}
        />
      )}

      {tab === 'rules' && (
        <PaginatedList<SafetyRuleRecord>
          key="rules"
          fetchPage={api.listSafetyRules}
          getKey={r => r.id}
          searchPlaceholder="Search by ingredient or contraindication…"
          columns={[
            { header: 'Ingredient', render: r => r.ingredient },
            { header: 'Contraindication', render: r => r.contraindication },
            { header: 'Severity', render: r => r.severity },
            { header: 'Notes', render: r => r.notes ?? '—' },
            { header: 'Source', render: r => r.source ?? '—' },
          ]}
        />
      )}
    </section>
  );
}
