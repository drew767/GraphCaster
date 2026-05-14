// Copyright GraphCaster. All Rights Reserved.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Select } from "../ui/Select/Select";
import { Badge } from "../ui/Badge/Badge";
import {
  getVersions,
  getLatestVersion,
  hasUpgrade,
  type NodeTypeVersionInfo,
} from "../../graph/nodeRegistry";

export interface NdvVersionSelectorProps {
  nodeType: string;
  currentVersion: number;
  onChange: (nextVersion: number) => void;
  disabled?: boolean;
}

export function NdvVersionSelector({
  nodeType,
  currentVersion,
  onChange,
  disabled = false,
}: NdvVersionSelectorProps) {
  const { t } = useTranslation();
  const versions: NodeTypeVersionInfo[] = useMemo(
    () => getVersions(nodeType),
    [nodeType],
  );

  if (versions.length <= 1) {
    return null;
  }

  const upgradeAvailable = hasUpgrade(nodeType, currentVersion);
  const latest = getLatestVersion(nodeType);

  const options = versions.map((v) => ({
    value: String(v.version),
    label:
      v.version === latest
        ? `${v.label ?? `v${v.version}`} · ${t("ndv.versions.latestTag")}`
        : v.label ?? `v${v.version}`,
  }));

  return (
    <div className="gc-ndv-version-selector" data-testid="ndv-version-selector">
      <label
        className="gc-ndv-version-selector__label"
        htmlFor="gc-ndv-version-select"
      >
        {t("ndv.versions.label")}
      </label>
      <Select<string>
        value={String(currentVersion)}
        onValueChange={(v) => {
          const next = parseInt(v, 10);
          if (Number.isFinite(next) && next !== currentVersion) {
            onChange(next);
          }
        }}
        options={options}
        size="small"
        disabled={disabled}
        aria-label={t("ndv.versions.ariaLabel")}
        data-testid="ndv-version-select"
      />
      {upgradeAvailable && (
        <span data-testid="ndv-version-upgrade-badge">
          <Badge
            text={t("ndv.versions.upgradeBadge")}
            variant="primary"
            size="small"
          />
        </span>
      )}
    </div>
  );
}
