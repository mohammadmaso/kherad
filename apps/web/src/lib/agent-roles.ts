/**
 * Stable preset company roles for the specialist agent. `key` is the
 * locale-independent identifier used to tag a skill's default roles
 * (packages/db `skill_role_defaults.role_key`); `en`/`fa` are the labels
 * shown in the role picker and the admin skill editor.
 */
export type AgentRolePreset = { key: string; en: string; fa: string };

export const AGENT_ROLE_PRESETS: AgentRolePreset[] = [
  { key: "product_manager", en: "Product manager", fa: "مدیر محصول" },
  { key: "engineering_manager", en: "Engineering manager", fa: "مدیر مهندسی" },
  { key: "software_engineer", en: "Software engineer", fa: "مهندس نرم‌افزار" },
  { key: "designer", en: "Designer", fa: "طراح" },
  { key: "qa_engineer", en: "QA engineer", fa: "مهندس تضمین کیفیت" },
  { key: "marketing_manager", en: "Marketing manager", fa: "مدیر بازاریابی" },
  { key: "sales_manager", en: "Sales manager", fa: "مدیر فروش" },
  { key: "hr_manager", en: "HR manager", fa: "مدیر منابع انسانی" },
  { key: "finance_manager", en: "Finance manager", fa: "مدیر مالی" },
  { key: "operations_manager", en: "Operations manager", fa: "مدیر عملیات" },
  { key: "legal_counsel", en: "Legal counsel", fa: "مشاور حقوقی" },
];

export function agentRoleLabel(key: string, locale: "en" | "fa"): string {
  const preset = AGENT_ROLE_PRESETS.find((p) => p.key === key);
  return preset ? preset[locale] : key;
}
