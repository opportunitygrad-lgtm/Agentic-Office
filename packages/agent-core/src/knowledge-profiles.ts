import type {
  AgentTemplateKey,
  BrandRuleCategory,
  CommercialRuleCategory,
  KnowledgeType,
} from "@aibos/shared";

/**
 * What an agent always needs to know. The Context Engine uses the profile to
 * pick required knowledge types, preferred tags and which brand/commercial
 * rule categories are always relevant. Individual agents may override it
 * (`agent_knowledge_profiles`).
 */
export interface AgentKnowledgeProfile {
  requiredTypes: KnowledgeType[];
  preferredTags: string[];
  brandCategories: BrandRuleCategory[];
  commercialCategories: CommercialRuleCategory[];
}

const CORE_BRAND: BrandRuleCategory[] = ["voice", "tone", "positioning"];

const DEFAULT: AgentKnowledgeProfile = {
  requiredTypes: ["company_fact", "policy"],
  preferredTags: [],
  brandCategories: CORE_BRAND,
  commercialCategories: [],
};

const MARKETING: AgentKnowledgeProfile = {
  requiredTypes: ["company_fact", "brand_rule", "marketing", "pricing", "service", "product"],
  preferredTags: ["marketing", "advertising", "brand", "claims"],
  brandCategories: [
    ...CORE_BRAND,
    "claims",
    "prohibited_terms",
    "approved_terms",
    "call_to_action",
    "advertising",
    "social_media",
    "visual",
  ],
  commercialCategories: ["advertising_budget", "pricing", "discount"],
};

const TECHNICAL: AgentKnowledgeProfile = {
  requiredTypes: ["technical", "sop", "website"],
  preferredTags: ["architecture", "security", "website", "technical"],
  brandCategories: ["website", "visual"],
  commercialCategories: [],
};

export const TEMPLATE_KNOWLEDGE: Record<AgentTemplateKey, AgentKnowledgeProfile> = {
  company_manager: {
    requiredTypes: ["company_fact", "policy", "service", "product", "sop"],
    preferredTags: ["strategy", "operations"],
    brandCategories: CORE_BRAND,
    commercialCategories: ["financial_approval", "revenue_target", "pricing"],
  },
  research: {
    requiredTypes: ["company_fact", "market_research", "competitor", "partnership"],
    preferredTags: ["research", "partners", "market"],
    brandCategories: ["positioning", "claims"],
    commercialCategories: [],
  },
  sales_cro: {
    requiredTypes: ["sales", "pricing", "service", "product", "faq", "customer_guidance"],
    preferredTags: ["sales", "enquiries", "pricing"],
    brandCategories: [...CORE_BRAND, "claims", "call_to_action"],
    commercialCategories: ["pricing", "discount", "payment", "refund", "sales_restriction"],
  },
  email_communications: {
    requiredTypes: [
      "company_fact",
      "communication_rule",
      "email_template",
      "pricing",
      "compliance",
      "faq",
    ],
    preferredTags: ["email", "communication", "enquiries"],
    brandCategories: [...CORE_BRAND, "email", "prohibited_terms", "approved_terms", "claims"],
    commercialCategories: ["pricing", "discount", "payment"],
  },
  marketing_manager: MARKETING,
  meta_ads: MARKETING,
  social_media: MARKETING,
  technical_cto: TECHNICAL,
  software_development: TECHNICAL,
  website_performance: TECHNICAL,
  seo: {
    requiredTypes: ["website", "marketing", "service", "product"],
    preferredTags: ["seo", "website", "content"],
    brandCategories: [...CORE_BRAND, "website", "claims", "prohibited_terms"],
    commercialCategories: [],
  },
  analytics: {
    requiredTypes: ["financial", "marketing", "company_fact"],
    preferredTags: ["analytics", "reporting", "kpi"],
    brandCategories: [],
    commercialCategories: ["revenue_target", "advertising_budget"],
  },
  finance_cost_controller: {
    requiredTypes: ["financial", "pricing", "policy"],
    preferredTags: ["finance", "budget", "costs"],
    brandCategories: [],
    commercialCategories: [
      "financial_approval",
      "advertising_budget",
      "payment",
      "refund",
      "pricing",
    ],
  },
  legal_commercial_review: {
    requiredTypes: ["legal", "compliance", "policy", "partnership"],
    preferredTags: ["legal", "contracts", "compliance"],
    brandCategories: ["claims", "prohibited_terms"],
    commercialCategories: ["pricing", "discount", "payment", "refund", "sales_restriction"],
  },
  lead_qualification: {
    requiredTypes: ["sales", "customer_guidance", "faq", "service"],
    preferredTags: ["leads", "qualification", "enquiries"],
    brandCategories: CORE_BRAND,
    commercialCategories: ["sales_restriction"],
  },
  partnership_manager: {
    requiredTypes: ["partnership", "company_fact", "communication_rule", "policy"],
    preferredTags: ["partners", "partnership"],
    brandCategories: [...CORE_BRAND, "claims", "email"],
    commercialCategories: ["pricing", "financial_approval"],
  },
  custom: DEFAULT,
};

export function getTemplateKnowledgeProfile(key: string): AgentKnowledgeProfile {
  return TEMPLATE_KNOWLEDGE[key as AgentTemplateKey] ?? DEFAULT;
}
