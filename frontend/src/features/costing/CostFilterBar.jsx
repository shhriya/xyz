import React from 'react';
import { Server, Shield, Tag, Layers, Users as UsersIcon, Building2 } from 'lucide-react';
import { MultiSelect } from './executive/ExecOverviewPrimitives';

/**
 * Shared filter bar for the Overview / Platform / Cortex AI tabs. Date range already lives in the
 * header's time-range pills, so this only covers the rest of the blueprint's "global filters on
 * every page": account (Level 0 only, and only when org-wide data is actually available), team/
 * cost-center, app/environment, service, user — all driven off one /filters call per account.
 */
export default function CostFilterBar({ dimensions, selected, onChange, showAccounts = false }) {
  if (!dimensions) return null;

  const set = (key) => (vals) => onChange({ ...selected, [key]: vals });

  const hasAnyDimension =
    (showAccounts && dimensions.accounts?.length > 0) ||
    dimensions.warehouses?.length > 0 ||
    dimensions.roles?.length > 0 ||
    dimensions.environments?.length > 0 ||
    dimensions.departments?.length > 0 ||
    dimensions.serviceTypes?.length > 0;

  if (!hasAnyDimension) return null;

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-2xl p-3 shadow-xs">
      <div className="flex flex-wrap items-end gap-3">
        {showAccounts && dimensions.accounts?.length > 0 && (
          <MultiSelect
            label="Account"
            icon={Building2}
            options={dimensions.accounts}
            selected={selected.accounts || []}
            onChange={set('accounts')}
          />
        )}
        {dimensions.warehouses?.length > 0 && (
          <MultiSelect
            label="Warehouse"
            icon={Server}
            options={dimensions.warehouses}
            selected={selected.warehouses || []}
            onChange={set('warehouses')}
          />
        )}
        {dimensions.roles?.length > 0 && (
          <MultiSelect
            label="Role"
            icon={Shield}
            options={dimensions.roles}
            selected={selected.roles || []}
            onChange={set('roles')}
          />
        )}
        {dimensions.environments?.length > 0 && (
          <MultiSelect
            label="Environment"
            icon={Layers}
            options={dimensions.environments}
            selected={selected.environments || []}
            onChange={set('environments')}
          />
        )}
        {dimensions.departments?.length > 0 && (
          <MultiSelect
            label="Team / Cost Center"
            icon={UsersIcon}
            options={dimensions.departments}
            selected={selected.departments || []}
            onChange={set('departments')}
          />
        )}
        {dimensions.serviceTypes?.length > 0 && (
          <MultiSelect
            label="Service"
            icon={Tag}
            options={dimensions.serviceTypes}
            selected={selected.serviceTypes || []}
            onChange={set('serviceTypes')}
          />
        )}
      </div>
    </div>
  );
}
