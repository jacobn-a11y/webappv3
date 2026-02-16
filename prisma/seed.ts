/**
 * StoryEngine — Database Seed
 *
 * Populates the database with realistic sample data for local development:
 *   - 3 organizations (different plans)
 *   - 10 CRM accounts spread across orgs
 *   - 30 calls with transcripts and taxonomy tags
 *   - 5 landing pages in various states
 *   - Full permission matrix across users/roles
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ─── Deterministic IDs for cross-references ─────────────────────────────────

const ids = {
  // Organizations
  org1: "org_acmecorp",
  org2: "org_globexinc",
  org3: "org_initech",

  // Users (3-4 per org)
  user_alice: "usr_alice",
  user_bob: "usr_bob",
  user_carol: "usr_carol",
  user_dave: "usr_dave",
  user_eve: "usr_eve",
  user_frank: "usr_frank",
  user_grace: "usr_grace",
  user_hank: "usr_hank",
  user_iris: "usr_iris",
  user_jack: "usr_jack",

  // Accounts (spread across orgs)
  acc_meridian: "acc_meridian",
  acc_northwind: "acc_northwind",
  acc_contoso: "acc_contoso",
  acc_fabrikam: "acc_fabrikam",
  acc_adventureworks: "acc_adventureworks",
  acc_wideworldimporters: "acc_wideworldimporters",
  acc_tailspintoys: "acc_tailspintoys",
  acc_fourthcoffee: "acc_fourthcoffee",
  acc_lucernepub: "acc_lucernepub",
  acc_proseware: "acc_proseware",
} as const;

// ─── Helper: date offsets ────────────────────────────────────────────────────

const now = new Date();
function daysAgo(n: number): Date {
  return new Date(now.getTime() - n * 86400000);
}

// ─── Seed: Organizations ─────────────────────────────────────────────────────

async function seedOrganizations() {
  const orgs = [
    {
      id: ids.org1,
      name: "Acme Corp",
      workosOrgId: "wos_org_acme_001",
      stripeCustomerId: "cus_acme_001",
      plan: "PROFESSIONAL" as const,
      trialEndsAt: null,
      updatedAt: now,
    },
    {
      id: ids.org2,
      name: "Globex Inc",
      workosOrgId: "wos_org_globex_002",
      stripeCustomerId: "cus_globex_002",
      plan: "FREE_TRIAL" as const,
      trialEndsAt: new Date(now.getTime() + 14 * 86400000),
      updatedAt: now,
    },
    {
      id: ids.org3,
      name: "Initech Solutions",
      workosOrgId: "wos_org_initech_003",
      stripeCustomerId: "cus_initech_003",
      plan: "ENTERPRISE" as const,
      trialEndsAt: null,
      updatedAt: now,
    },
  ];

  for (const org of orgs) {
    await prisma.organization.upsert({
      where: { id: org.id },
      update: org,
      create: org,
    });
  }
}

// ─── Seed: Users ─────────────────────────────────────────────────────────────

async function seedUsers() {
  const users = [
    // Acme Corp — 4 users
    { id: ids.user_alice, email: "alice@acmecorp.com", name: "Alice Martinez", workosUserId: "wos_usr_alice", organizationId: ids.org1, role: "OWNER" as const },
    { id: ids.user_bob, email: "bob@acmecorp.com", name: "Bob Chen", workosUserId: "wos_usr_bob", organizationId: ids.org1, role: "ADMIN" as const },
    { id: ids.user_carol, email: "carol@acmecorp.com", name: "Carol Williams", workosUserId: "wos_usr_carol", organizationId: ids.org1, role: "MEMBER" as const },
    { id: ids.user_dave, email: "dave@acmecorp.com", name: "Dave Thompson", workosUserId: "wos_usr_dave", organizationId: ids.org1, role: "VIEWER" as const },
    // Globex Inc — 3 users
    { id: ids.user_eve, email: "eve@globexinc.com", name: "Eve Rodriguez", workosUserId: "wos_usr_eve", organizationId: ids.org2, role: "OWNER" as const },
    { id: ids.user_frank, email: "frank@globexinc.com", name: "Frank Nguyen", workosUserId: "wos_usr_frank", organizationId: ids.org2, role: "MEMBER" as const },
    { id: ids.user_grace, email: "grace@globexinc.com", name: "Grace Park", workosUserId: "wos_usr_grace", organizationId: ids.org2, role: "VIEWER" as const },
    // Initech Solutions — 3 users
    { id: ids.user_hank, email: "hank@initech.io", name: "Hank Patel", workosUserId: "wos_usr_hank", organizationId: ids.org3, role: "OWNER" as const },
    { id: ids.user_iris, email: "iris@initech.io", name: "Iris Kim", workosUserId: "wos_usr_iris", organizationId: ids.org3, role: "ADMIN" as const },
    { id: ids.user_jack, email: "jack@initech.io", name: "Jack Rivera", workosUserId: "wos_usr_jack", organizationId: ids.org3, role: "MEMBER" as const },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { id: u.id },
      update: { ...u, updatedAt: now },
      create: { ...u, updatedAt: now },
    });
  }
}

// ─── Seed: CRM Accounts ─────────────────────────────────────────────────────

interface AccountSeed {
  id: string;
  organizationId: string;
  name: string;
  normalizedName: string;
  domain: string | null;
  salesforceId: string | null;
  industry: string;
  employeeCount: number;
  annualRevenue: number;
}

async function seedAccounts() {
  const accounts: AccountSeed[] = [
    // Acme Corp's CRM accounts (4)
    { id: ids.acc_meridian, organizationId: ids.org1, name: "Meridian Health Systems", normalizedName: "meridian health systems", domain: "meridianhealth.com", salesforceId: "001SF_MERIDIAN", industry: "Healthcare", employeeCount: 12000, annualRevenue: 4200000000 },
    { id: ids.acc_northwind, organizationId: ids.org1, name: "Northwind Traders", normalizedName: "northwind traders", domain: "northwindtraders.com", salesforceId: "001SF_NORTHWIND", industry: "Retail & E-Commerce", employeeCount: 3500, annualRevenue: 890000000 },
    { id: ids.acc_contoso, organizationId: ids.org1, name: "Contoso Ltd", normalizedName: "contoso", domain: "contoso.com", salesforceId: "001SF_CONTOSO", industry: "Manufacturing", employeeCount: 8000, annualRevenue: 2100000000 },
    { id: ids.acc_fabrikam, organizationId: ids.org1, name: "Fabrikam, Inc.", normalizedName: "fabrikam", domain: "fabrikam.com", salesforceId: "001SF_FABRIKAM", industry: "Financial Services", employeeCount: 5500, annualRevenue: 1800000000 },
    // Globex Inc's CRM accounts (3)
    { id: ids.acc_adventureworks, organizationId: ids.org2, name: "Adventure Works Cycles", normalizedName: "adventure works cycles", domain: "adventureworks.com", salesforceId: null, industry: "Consumer Goods", employeeCount: 1200, annualRevenue: 340000000 },
    { id: ids.acc_wideworldimporters, organizationId: ids.org2, name: "Wide World Importers", normalizedName: "wide world importers", domain: "wideworldimporters.com", salesforceId: null, industry: "Logistics & Supply Chain", employeeCount: 2800, annualRevenue: 720000000 },
    { id: ids.acc_tailspintoys, organizationId: ids.org2, name: "Tailspin Toys", normalizedName: "tailspin toys", domain: "tailspintoys.com", salesforceId: null, industry: "Consumer Electronics", employeeCount: 900, annualRevenue: 210000000 },
    // Initech Solutions' CRM accounts (3)
    { id: ids.acc_fourthcoffee, organizationId: ids.org3, name: "Fourth Coffee", normalizedName: "fourth coffee", domain: "fourthcoffee.com", salesforceId: "001SF_4THCOFFEE", industry: "Food & Beverage", employeeCount: 4200, annualRevenue: 960000000 },
    { id: ids.acc_lucernepub, organizationId: ids.org3, name: "Lucerne Publishing", normalizedName: "lucerne publishing", domain: "lucernepub.com", salesforceId: "001SF_LUCERNE", industry: "Media & Publishing", employeeCount: 1800, annualRevenue: 410000000 },
    { id: ids.acc_proseware, organizationId: ids.org3, name: "Proseware, Inc.", normalizedName: "proseware", domain: "proseware.com", salesforceId: "001SF_PROSEWARE", industry: "Technology", employeeCount: 6500, annualRevenue: 2400000000 },
  ];

  for (const acc of accounts) {
    await prisma.account.upsert({
      where: { id: acc.id },
      update: { ...acc, updatedAt: now },
      create: { ...acc, updatedAt: now },
    });
  }

  // Domain aliases
  const aliases = [
    { id: "ad_meridian_1", accountId: ids.acc_meridian, domain: "meridianhs.org" },
    { id: "ad_contoso_1", accountId: ids.acc_contoso, domain: "contoso.co.uk" },
    { id: "ad_proseware_1", accountId: ids.acc_proseware, domain: "proseware.io" },
  ];
  for (const alias of aliases) {
    await prisma.accountDomain.upsert({
      where: { id: alias.id },
      update: alias,
      create: alias,
    });
  }
}

// ─── Seed: Contacts ──────────────────────────────────────────────────────────

interface ContactSeed {
  id: string;
  accountId: string;
  email: string;
  emailDomain: string;
  name: string;
  title: string;
}

async function seedContacts() {
  const contacts: ContactSeed[] = [
    { id: "con_sarah", accountId: ids.acc_meridian, email: "sarah.jones@meridianhealth.com", emailDomain: "meridianhealth.com", name: "Sarah Jones", title: "VP of Operations" },
    { id: "con_mike", accountId: ids.acc_meridian, email: "mike.riley@meridianhealth.com", emailDomain: "meridianhealth.com", name: "Mike Riley", title: "Director of IT" },
    { id: "con_linda", accountId: ids.acc_northwind, email: "linda.zhang@northwindtraders.com", emailDomain: "northwindtraders.com", name: "Linda Zhang", title: "CTO" },
    { id: "con_raj", accountId: ids.acc_contoso, email: "raj.patel@contoso.com", emailDomain: "contoso.com", name: "Raj Patel", title: "Head of Engineering" },
    { id: "con_emma", accountId: ids.acc_contoso, email: "emma.davis@contoso.com", emailDomain: "contoso.com", name: "Emma Davis", title: "Product Manager" },
    { id: "con_tom", accountId: ids.acc_fabrikam, email: "tom.wilson@fabrikam.com", emailDomain: "fabrikam.com", name: "Tom Wilson", title: "CISO" },
    { id: "con_anna", accountId: ids.acc_adventureworks, email: "anna.lee@adventureworks.com", emailDomain: "adventureworks.com", name: "Anna Lee", title: "VP of Engineering" },
    { id: "con_james", accountId: ids.acc_wideworldimporters, email: "james.brown@wideworldimporters.com", emailDomain: "wideworldimporters.com", name: "James Brown", title: "Supply Chain Director" },
    { id: "con_priya", accountId: ids.acc_tailspintoys, email: "priya.sharma@tailspintoys.com", emailDomain: "tailspintoys.com", name: "Priya Sharma", title: "Head of Digital" },
    { id: "con_david", accountId: ids.acc_fourthcoffee, email: "david.kim@fourthcoffee.com", emailDomain: "fourthcoffee.com", name: "David Kim", title: "COO" },
    { id: "con_maria", accountId: ids.acc_lucernepub, email: "maria.garcia@lucernepub.com", emailDomain: "lucernepub.com", name: "Maria Garcia", title: "Director of Technology" },
    { id: "con_chen", accountId: ids.acc_proseware, email: "chen.wei@proseware.com", emailDomain: "proseware.com", name: "Chen Wei", title: "VP of Platform Engineering" },
    { id: "con_nina", accountId: ids.acc_proseware, email: "nina.volkov@proseware.com", emailDomain: "proseware.com", name: "Nina Volkov", title: "Engineering Manager" },
  ];

  for (const c of contacts) {
    await prisma.contact.upsert({
      where: { id: c.id },
      update: { ...c, updatedAt: now },
      create: { ...c, updatedAt: now },
    });
  }
}

// ─── Seed: Calls, Transcripts, Participants, Tags ────────────────────────────

interface CallDef {
  id: string;
  organizationId: string;
  accountId: string;
  title: string;
  provider: string;
  duration: number;
  occurredAt: Date;
  hostUserId: string;
  contactId: string;
  transcript: string;
  tags: Array<{ funnelStage: string; topic: string; confidence: number }>;
}

function buildCalls(): CallDef[] {
  return [
    // ── Acme Corp / Meridian Health (4 calls — full journey) ──
    {
      id: "call_01", organizationId: ids.org1, accountId: ids.acc_meridian,
      title: "Meridian Health - Initial Discovery", provider: "GONG", duration: 2400, occurredAt: daysAgo(90),
      hostUserId: ids.user_alice, contactId: "con_sarah",
      transcript: `Sarah Jones: Thanks for taking the time today. We've been struggling with fragmented patient data across our 14 hospital sites. Our clinicians waste about 30 minutes per shift just looking for records.\n\nAlice Martinez: That's a significant pain point we hear frequently in healthcare. Can you walk me through your current tech stack?\n\nSarah Jones: We're on a legacy Epic integration that was customized heavily in 2018. It's become a maintenance nightmare. Our IT team spends 60% of their time just keeping it running.\n\nAlice Martinez: And what would success look like for you if we could solve this?\n\nSarah Jones: Honestly, if we could cut that clinician search time in half and reduce our IT maintenance burden, that alone would justify the investment. We're talking about potential savings of $2.4 million annually.`,
      tags: [
        { funnelStage: "TOFU", topic: "problem_challenge_identification", confidence: 0.95 },
        { funnelStage: "TOFU", topic: "digital_transformation_modernization", confidence: 0.82 },
      ],
    },
    {
      id: "call_02", organizationId: ids.org1, accountId: ids.acc_meridian,
      title: "Meridian Health - Technical Deep Dive", provider: "GONG", duration: 3600, occurredAt: daysAgo(75),
      hostUserId: ids.user_bob, contactId: "con_mike",
      transcript: `Mike Riley: I want to understand how your platform handles HL7 FHIR compliance. We're under strict HIPAA audit requirements.\n\nBob Chen: Great question. Our platform is FHIR R4 native and we maintain SOC 2 Type II certification. Let me share our compliance documentation.\n\nMike Riley: What about the integration timeline? We've been burned before with 18-month implementations that never fully delivered.\n\nBob Chen: For organizations your size, we typically see a 12-week phased rollout. Phase one covers your core EHR integration, phase two adds the analytics layer.\n\nMike Riley: That's much more aggressive than what we've seen. What's your track record on hitting those timelines?\n\nBob Chen: 94% of our healthcare deployments go live within the committed timeframe. I can connect you with Baystate Health — similar size, went live in 10 weeks.`,
      tags: [
        { funnelStage: "MOFU", topic: "integration_interoperability", confidence: 0.93 },
        { funnelStage: "MOFU", topic: "security_compliance_governance", confidence: 0.91 },
        { funnelStage: "MOFU", topic: "implementation_onboarding", confidence: 0.85 },
      ],
    },
    {
      id: "call_03", organizationId: ids.org1, accountId: ids.acc_meridian,
      title: "Meridian Health - ROI & Executive Review", provider: "GONG", duration: 1800, occurredAt: daysAgo(60),
      hostUserId: ids.user_alice, contactId: "con_sarah",
      transcript: `Sarah Jones: I presented the business case to our CFO last week. She wants to understand the payback period.\n\nAlice Martinez: Based on the metrics you shared — $2.4M in annual savings potential — you'd see full payback within 8 months. That includes implementation costs.\n\nSarah Jones: And the risk mitigation angle is strong too. We had a compliance near-miss last quarter that could have cost us $5M in penalties.\n\nAlice Martinez: Exactly. Three of our healthcare clients have told us the compliance automation alone justified the purchase. Would it help to have our CFO connect with yours?\n\nSarah Jones: That would be perfect. Also, the deployment speed is a key factor — our board wants measurable results within Q2.`,
      tags: [
        { funnelStage: "BOFU", topic: "roi_financial_outcomes", confidence: 0.97 },
        { funnelStage: "BOFU", topic: "risk_mitigation_continuity", confidence: 0.88 },
        { funnelStage: "BOFU", topic: "deployment_speed", confidence: 0.79 },
      ],
    },
    {
      id: "call_04", organizationId: ids.org1, accountId: ids.acc_meridian,
      title: "Meridian Health - 90-Day Success Review", provider: "GONG", duration: 2100, occurredAt: daysAgo(15),
      hostUserId: ids.user_alice, contactId: "con_sarah",
      transcript: `Sarah Jones: I have to say, the results have exceeded our expectations. Clinician search time is down 62%, not the 50% we targeted.\n\nAlice Martinez: That's wonderful to hear. What about the IT maintenance side?\n\nSarah Jones: IT maintenance hours dropped by 45%. Mike's team is actually working on new projects for the first time in two years. Morale has completely shifted.\n\nAlice Martinez: Would you be open to being a reference for other health systems we're working with?\n\nSarah Jones: Absolutely. We're also interested in expanding to our outpatient clinics — that's another 22 sites. Can we talk about the expansion pricing?\n\nAlice Martinez: Of course. I'll put together a proposal for the expansion. This is exactly the kind of partnership growth we love to see.`,
      tags: [
        { funnelStage: "POST_SALE", topic: "upsell_cross_sell_expansion", confidence: 0.94 },
        { funnelStage: "POST_SALE", topic: "customer_success_support", confidence: 0.86 },
        { funnelStage: "POST_SALE", topic: "reference_ability_development", confidence: 0.82 },
      ],
    },

    // ── Acme Corp / Northwind Traders (3 calls) ──
    {
      id: "call_05", organizationId: ids.org1, accountId: ids.acc_northwind,
      title: "Northwind Traders - Discovery Call", provider: "ZOOM", duration: 1800, occurredAt: daysAgo(45),
      hostUserId: ids.user_carol, contactId: "con_linda",
      transcript: `Linda Zhang: Our e-commerce platform processes 2 million orders per month and we're seeing performance degradation during peak hours. Black Friday last year was a disaster — 12% of transactions failed.\n\nCarol Williams: What's your current infrastructure look like?\n\nLinda Zhang: Monolithic Java application on bare-metal servers. We've been talking about moving to microservices for two years but haven't made the leap.\n\nCarol Williams: The transition from monolith to microservices is one of our sweet spots. We've helped retailers like REI and Zappos make that shift. What's holding you back?\n\nLinda Zhang: Mostly risk aversion. Our last major platform change took 14 months and we lost market share during the transition.`,
      tags: [
        { funnelStage: "TOFU", topic: "problem_challenge_identification", confidence: 0.92 },
        { funnelStage: "TOFU", topic: "digital_transformation_modernization", confidence: 0.88 },
      ],
    },
    {
      id: "call_06", organizationId: ids.org1, accountId: ids.acc_northwind,
      title: "Northwind Traders - Competitive Evaluation", provider: "ZOOM", duration: 2700, occurredAt: daysAgo(30),
      hostUserId: ids.user_bob, contactId: "con_linda",
      transcript: `Linda Zhang: We're evaluating three vendors including you. The other two are proposing a full rip-and-replace approach.\n\nBob Chen: That's a high-risk strategy for a platform doing $890M in annual revenue. Our approach is incremental — we call it the Strangler Fig pattern. You migrate service by service while the monolith keeps running.\n\nLinda Zhang: How does that compare on total cost?\n\nBob Chen: Typically 30-40% less than a full rewrite because you avoid the dual-run costs. Plus your team continues shipping features during migration instead of freezing development.\n\nLinda Zhang: That's compelling. What about time to first value?\n\nBob Chen: Most clients see their first microservice in production within 6 weeks. For Northwind, I'd target your order processing service first — highest impact, well-bounded domain.`,
      tags: [
        { funnelStage: "MOFU", topic: "competitive_displacement", confidence: 0.95 },
        { funnelStage: "MOFU", topic: "total_cost_of_ownership", confidence: 0.87 },
        { funnelStage: "MOFU", topic: "pilot_to_production", confidence: 0.81 },
      ],
    },
    {
      id: "call_07", organizationId: ids.org1, accountId: ids.acc_northwind,
      title: "Northwind - Procurement & Contract Review", provider: "ZOOM", duration: 1500, occurredAt: daysAgo(20),
      hostUserId: ids.user_alice, contactId: "con_linda",
      transcript: `Linda Zhang: Legal has reviewed the MSA and we're good. Two questions from procurement: can you match the competitor's payment terms of net-90?\n\nAlice Martinez: We can do net-60 with a 2% early payment discount. Most of our enterprise clients prefer this structure.\n\nLinda Zhang: That works. Second, we need a performance SLA with financial penalties.\n\nAlice Martinez: Standard in our enterprise tier — 99.95% uptime SLA with service credits. I'll have our legal team send the SLA addendum today.\n\nLinda Zhang: Perfect. I think we can get signatures by end of week.`,
      tags: [
        { funnelStage: "BOFU", topic: "procurement_experience", confidence: 0.93 },
        { funnelStage: "BOFU", topic: "vendor_selection_criteria", confidence: 0.78 },
      ],
    },

    // ── Acme Corp / Contoso (3 calls) ──
    {
      id: "call_08", organizationId: ids.org1, accountId: ids.acc_contoso,
      title: "Contoso - Manufacturing IoT Discussion", provider: "TEAMS", duration: 2100, occurredAt: daysAgo(50),
      hostUserId: ids.user_bob, contactId: "con_raj",
      transcript: `Raj Patel: We have 340 production lines across 8 factories generating terabytes of sensor data daily. Right now we're only analyzing about 5% of it.\n\nBob Chen: What's preventing you from analyzing more?\n\nRaj Patel: Our current analytics platform can't handle the throughput. By the time we process the data, it's already stale. We need real-time anomaly detection.\n\nBob Chen: This is a classic edge computing use case. Our IoT gateway can pre-process at the factory level and only send anomalies upstream. That typically reduces data transfer by 85% while giving you sub-second alerting.\n\nRaj Patel: Interesting. Emma, our PM, has been pushing for predictive maintenance. Could this feed into that?\n\nBob Chen: Absolutely. Predictive maintenance is a natural second phase once you have the real-time data pipeline in place.`,
      tags: [
        { funnelStage: "TOFU", topic: "industry_trend_validation", confidence: 0.89 },
        { funnelStage: "MOFU", topic: "product_capability_deepdive", confidence: 0.92 },
      ],
    },
    {
      id: "call_09", organizationId: ids.org1, accountId: ids.acc_contoso,
      title: "Contoso - Security & Compliance Review", provider: "TEAMS", duration: 1800, occurredAt: daysAgo(35),
      hostUserId: ids.user_bob, contactId: "con_emma",
      transcript: `Emma Davis: Our factories in Germany and Japan have strict data residency requirements. Can your platform handle multi-region deployments?\n\nBob Chen: Yes, we support data residency in 14 regions including Frankfurt and Tokyo. Each factory's data stays within its geographic boundary.\n\nEmma Davis: What about the new EU Cyber Resilience Act? We need to be compliant by Q3.\n\nBob Chen: We've been working on CRA compliance since the draft was published. Our platform will be certified by end of Q1, well ahead of your deadline.\n\nEmma Davis: That's reassuring. The compliance angle is actually what will sell this internally — our CISO has veto power on all new vendor relationships.`,
      tags: [
        { funnelStage: "MOFU", topic: "security_compliance_governance", confidence: 0.96 },
        { funnelStage: "TOFU", topic: "regulatory_compliance_challenges", confidence: 0.90 },
      ],
    },
    {
      id: "call_10", organizationId: ids.org1, accountId: ids.acc_contoso,
      title: "Contoso - Executive Metrics Review", provider: "TEAMS", duration: 2400, occurredAt: daysAgo(10),
      hostUserId: ids.user_alice, contactId: "con_raj",
      transcript: `Raj Patel: The pilot on Line 7 has been running for three weeks and the results are remarkable. We detected 14 anomalies that would have caused unplanned downtime.\n\nAlice Martinez: What's the estimated cost avoidance?\n\nRaj Patel: Each unplanned stop costs us roughly $180,000. So we're looking at $2.5 million in avoided downtime in just three weeks on one production line.\n\nAlice Martinez: Extrapolating across your 340 lines, that's transformative.\n\nRaj Patel: Exactly. The board approved full deployment yesterday. We want to roll out to all 8 factories by end of year.\n\nAlice Martinez: Congratulations. We'll have the deployment plan ready by Monday.`,
      tags: [
        { funnelStage: "BOFU", topic: "quantified_operational_metrics", confidence: 0.97 },
        { funnelStage: "BOFU", topic: "roi_financial_outcomes", confidence: 0.94 },
        { funnelStage: "BOFU", topic: "executive_strategic_impact", confidence: 0.85 },
      ],
    },

    // ── Acme Corp / Fabrikam (2 calls) ──
    {
      id: "call_11", organizationId: ids.org1, accountId: ids.acc_fabrikam,
      title: "Fabrikam - Financial Services Security Briefing", provider: "GONG", duration: 2700, occurredAt: daysAgo(25),
      hostUserId: ids.user_bob, contactId: "con_tom",
      transcript: `Tom Wilson: As CISO, my primary concern is our attack surface. We've grown through three acquisitions and each brought its own security stack. We have 47 security tools that don't talk to each other.\n\nBob Chen: Tool sprawl is the number one challenge we see in financial services. Our unified security platform can consolidate those 47 tools down to a single pane of glass.\n\nTom Wilson: What's the typical consolidation ratio?\n\nBob Chen: On average, our FinServ clients reduce their security tooling by 60-70%, which translates to significant license savings plus reduced operational complexity.\n\nTom Wilson: We're spending $8.2 million annually on security tooling. Even a 50% reduction would be massive.`,
      tags: [
        { funnelStage: "TOFU", topic: "problem_challenge_identification", confidence: 0.91 },
        { funnelStage: "MOFU", topic: "product_capability_deepdive", confidence: 0.88 },
        { funnelStage: "VERTICAL", topic: "industry_specific_usecase", confidence: 0.84 },
      ],
    },
    {
      id: "call_12", organizationId: ids.org1, accountId: ids.acc_fabrikam,
      title: "Fabrikam - Vendor Selection Criteria Discussion", provider: "GONG", duration: 1800, occurredAt: daysAgo(12),
      hostUserId: ids.user_alice, contactId: "con_tom",
      transcript: `Tom Wilson: We've narrowed it down to you and one other vendor. The board wants a decision by month-end. What separates you from the competition?\n\nAlice Martinez: Three things: First, our FedRAMP High authorization — the other vendor is only FedRAMP Moderate. Second, our real-time threat correlation engine processes events in under 50 milliseconds. Third, we're the only platform with native SWIFT CSP compliance.\n\nTom Wilson: The SWIFT compliance is a differentiator. We've been doing that manually and it's a nightmare.\n\nAlice Martinez: We can also provide references from three of the top 10 US banks. They've all consolidated onto our platform in the last 18 months.\n\nTom Wilson: Send me those references. If they check out, I think we have a deal.`,
      tags: [
        { funnelStage: "BOFU", topic: "vendor_selection_criteria", confidence: 0.96 },
        { funnelStage: "BOFU", topic: "risk_mitigation_continuity", confidence: 0.83 },
      ],
    },

    // ── Globex Inc / Adventure Works (3 calls) ──
    {
      id: "call_13", organizationId: ids.org2, accountId: ids.acc_adventureworks,
      title: "Adventure Works - D2C Platform Discovery", provider: "CHORUS", duration: 1500, occurredAt: daysAgo(40),
      hostUserId: ids.user_eve, contactId: "con_anna",
      transcript: `Anna Lee: We're launching a direct-to-consumer channel alongside our retail partnerships. We need a platform that can handle both B2B and B2C in a single system.\n\nEve Rodriguez: That's a challenge we've solved for several consumer brands. Tell me about your current D2C volume.\n\nAnna Lee: We're starting from zero online, but our retail partners do about $340 million through our products. We're targeting $50 million in D2C within the first year.\n\nEve Rodriguez: Ambitious but achievable. The key will be inventory orchestration so you don't create channel conflict with your retail partners.`,
      tags: [
        { funnelStage: "TOFU", topic: "market_expansion", confidence: 0.91 },
        { funnelStage: "TOFU", topic: "digital_transformation_modernization", confidence: 0.84 },
      ],
    },
    {
      id: "call_14", organizationId: ids.org2, accountId: ids.acc_adventureworks,
      title: "Adventure Works - Platform Demo & Integration", provider: "CHORUS", duration: 3000, occurredAt: daysAgo(28),
      hostUserId: ids.user_frank, contactId: "con_anna",
      transcript: `Frank Nguyen: Let me walk you through our unified commerce platform. Here's the inventory orchestration engine I mentioned — it routes orders to the optimal fulfillment point based on proximity, stock levels, and channel priority rules.\n\nAnna Lee: Can it prioritize our retail partners during key selling seasons?\n\nFrank Nguyen: Absolutely. You set business rules per channel. For example, allocate 70% of holiday inventory to retail partners and 30% to D2C. The system enforces it automatically.\n\nAnna Lee: What about our existing ERP? We're on SAP S/4HANA.\n\nFrank Nguyen: We have a certified SAP connector that syncs in real-time. Inventory counts, pricing, order status — all bidirectional. Most SAP integrations go live in 4 weeks.\n\nAnna Lee: That's faster than I expected. What about Shopify for the D2C storefront?\n\nFrank Nguyen: Native Shopify Plus integration. Your team manages the storefront in Shopify, we handle the backend orchestration.`,
      tags: [
        { funnelStage: "MOFU", topic: "integration_interoperability", confidence: 0.95 },
        { funnelStage: "MOFU", topic: "product_capability_deepdive", confidence: 0.90 },
        { funnelStage: "MOFU", topic: "customization_configurability", confidence: 0.82 },
      ],
    },
    {
      id: "call_15", organizationId: ids.org2, accountId: ids.acc_adventureworks,
      title: "Adventure Works - Contract Negotiation", provider: "CHORUS", duration: 1200, occurredAt: daysAgo(18),
      hostUserId: ids.user_eve, contactId: "con_anna",
      transcript: `Anna Lee: The team loves the platform. We want to move forward. Can we start with just the D2C channel and add B2B orchestration in phase two?\n\nEve Rodriguez: Of course. Our modular licensing lets you start with the commerce engine and add modules as you grow. D2C module pricing is $12K/month at your projected volume.\n\nAnna Lee: And when we add B2B?\n\nEve Rodriguez: We'll lock in today's per-module pricing for any additions within 12 months. So the B2B module would be an additional $8K/month at the same rate.\n\nAnna Lee: Fair. Let's do it. I'll get the PO issued this week.`,
      tags: [
        { funnelStage: "BOFU", topic: "procurement_experience", confidence: 0.90 },
        { funnelStage: "MOFU", topic: "multi_product_cross_sell", confidence: 0.78 },
      ],
    },

    // ── Globex Inc / Wide World Importers (3 calls) ──
    {
      id: "call_16", organizationId: ids.org2, accountId: ids.acc_wideworldimporters,
      title: "Wide World Importers - Supply Chain Visibility", provider: "GOOGLE_MEET", duration: 2400, occurredAt: daysAgo(55),
      hostUserId: ids.user_eve, contactId: "con_james",
      transcript: `James Brown: We move goods through 23 countries and we have zero real-time visibility once a shipment leaves the origin warehouse. Last quarter we had $4.2 million in spoilage from temperature excursions we didn't catch.\n\nEve Rodriguez: That's a solvable problem. Our supply chain visibility platform ingests data from IoT sensors, carrier APIs, and port systems to give you a real-time digital twin of every shipment.\n\nJames Brown: How many carriers do you support?\n\nEve Rodriguez: Over 600 carriers and 35 port systems globally. We handle ocean, air, rail, and ground. The platform normalizes all the data into a single tracking interface.\n\nJames Brown: The spoilage alone would justify this. What about predictive ETA?\n\nEve Rodriguez: Our ML models predict arrival times with 94% accuracy within a 2-hour window, even for complex multi-modal routes.`,
      tags: [
        { funnelStage: "TOFU", topic: "problem_challenge_identification", confidence: 0.94 },
        { funnelStage: "MOFU", topic: "product_capability_deepdive", confidence: 0.91 },
      ],
    },
    {
      id: "call_17", organizationId: ids.org2, accountId: ids.acc_wideworldimporters,
      title: "Wide World Importers - Pilot Results", provider: "GOOGLE_MEET", duration: 1800, occurredAt: daysAgo(30),
      hostUserId: ids.user_frank, contactId: "con_james",
      transcript: `James Brown: The pilot on the Shanghai-Rotterdam lane has been eye-opening. We caught three temperature excursions in real-time and rerouted the containers before any spoilage occurred.\n\nFrank Nguyen: What was the estimated savings from those interventions?\n\nJames Brown: About $890,000 in product that would have been lost. And that's just one lane out of our 150 active routes.\n\nFrank Nguyen: If we extrapolate that across your full network, you're looking at tens of millions in annual savings.\n\nJames Brown: The CFO ran the numbers — she's projecting $18 million in annual spoilage reduction. That's a 4x ROI on the platform cost.\n\nFrank Nguyen: Shall we discuss the full deployment timeline?`,
      tags: [
        { funnelStage: "BOFU", topic: "roi_financial_outcomes", confidence: 0.96 },
        { funnelStage: "BOFU", topic: "quantified_operational_metrics", confidence: 0.92 },
      ],
    },
    {
      id: "call_18", organizationId: ids.org2, accountId: ids.acc_wideworldimporters,
      title: "Wide World - Post-Go-Live Training", provider: "GOOGLE_MEET", duration: 2700, occurredAt: daysAgo(8),
      hostUserId: ids.user_frank, contactId: "con_james",
      transcript: `James Brown: The ops team has really taken to the platform. We're seeing 85% daily active usage across our logistics coordinators.\n\nFrank Nguyen: That's excellent adoption. How's the alerting working for your team?\n\nJames Brown: The automated alerts saved us twice last week — a customs hold in Singapore and a weather delay in the Panama Canal. Both times the team rerouted before any SLA breach.\n\nFrank Nguyen: Great. For the next phase, we should look at demand forecasting integration. Several of our logistics clients have reduced safety stock by 20% using our predictive tools.\n\nJames Brown: Definitely interested. Let's schedule a deep dive on that for next month.`,
      tags: [
        { funnelStage: "POST_SALE", topic: "training_enablement_adoption", confidence: 0.90 },
        { funnelStage: "POST_SALE", topic: "upsell_cross_sell_expansion", confidence: 0.85 },
        { funnelStage: "POST_SALE", topic: "customer_success_support", confidence: 0.80 },
      ],
    },

    // ── Globex Inc / Tailspin Toys (2 calls) ──
    {
      id: "call_19", organizationId: ids.org2, accountId: ids.acc_tailspintoys,
      title: "Tailspin Toys - Digital Marketplace Strategy", provider: "ZOOM", duration: 1800, occurredAt: daysAgo(22),
      hostUserId: ids.user_eve, contactId: "con_priya",
      transcript: `Priya Sharma: We want to launch a digital marketplace for our toy accessories — things like custom decals, replacement parts, digital content. Our physical toys are the gateway to a digital ecosystem.\n\nEve Rodriguez: That's a smart play. The toy-to-digital pipeline is a growing trend. What's your target for digital revenue?\n\nPriya Sharma: $25 million in Year 1 from digital accessories and content. We have 8 million active app users who would be the initial audience.\n\nEve Rodriguez: With 8 million MAUs, that's roughly $3 ARPU target. Very achievable with the right marketplace infrastructure.\n\nPriya Sharma: Exactly. But we need it up fast — holiday season is our window.`,
      tags: [
        { funnelStage: "TOFU", topic: "market_expansion", confidence: 0.93 },
        { funnelStage: "VERTICAL", topic: "industry_specific_usecase", confidence: 0.86 },
      ],
    },
    {
      id: "call_20", organizationId: ids.org2, accountId: ids.acc_tailspintoys,
      title: "Tailspin Toys - Technical Architecture Review", provider: "ZOOM", duration: 2400, occurredAt: daysAgo(14),
      hostUserId: ids.user_frank, contactId: "con_priya",
      transcript: `Priya Sharma: Our mobile app is built on React Native and our backend is on AWS. How does your marketplace integrate?\n\nFrank Nguyen: We provide a headless commerce API that sits behind your existing app. Your React Native frontend calls our APIs for product catalog, cart, checkout, and digital asset delivery.\n\nPriya Sharma: What about the third-party sellers? We want to allow accessory makers to list their products.\n\nFrank Nguyen: Our multi-vendor marketplace module handles seller onboarding, commission management, and payouts. You set the commission rates and approval workflows.\n\nPriya Sharma: And content delivery for digital goods?\n\nFrank Nguyen: CDN-backed delivery with DRM for premium content. Average download time under 200ms globally. We handle licensing, access control, and purchase history.\n\nPriya Sharma: This is exactly what we need. What's the fastest you could get us to production?\n\nFrank Nguyen: With your existing infrastructure, 8 weeks to MVP with core marketplace features. Full multi-vendor capability in 12 weeks.`,
      tags: [
        { funnelStage: "MOFU", topic: "product_capability_deepdive", confidence: 0.94 },
        { funnelStage: "MOFU", topic: "integration_interoperability", confidence: 0.89 },
        { funnelStage: "MOFU", topic: "partner_ecosystem_solution", confidence: 0.81 },
      ],
    },

    // ── Initech Solutions / Fourth Coffee (3 calls) ──
    {
      id: "call_21", organizationId: ids.org3, accountId: ids.acc_fourthcoffee,
      title: "Fourth Coffee - Loyalty Platform Discovery", provider: "GONG", duration: 2100, occurredAt: daysAgo(65),
      hostUserId: ids.user_hank, contactId: "con_david",
      transcript: `David Kim: Our loyalty program has 12 million members but engagement is declining. Monthly active rate dropped from 45% to 31% over the past year.\n\nHank Patel: What do you attribute the decline to?\n\nDavid Kim: Honestly, the program is stale. Points-for-purchases isn't compelling anymore. Our competitors are doing personalized offers, gamification, tiered rewards. We're stuck on a 10-year-old platform that can't support any of that.\n\nHank Patel: That's a common pattern. The good news is that your 12 million member base is incredibly valuable — the data you have on purchase patterns is a goldmine for personalization.\n\nDavid Kim: We know that. We just can't unlock it with our current tech. Our data team says we'd need 6 months just to build a recommendation engine from scratch.\n\nHank Patel: Our platform comes with pre-built ML models for purchase propensity, churn prediction, and personalized offer matching. Most F&B clients see a 15-20% lift in engagement within the first quarter.`,
      tags: [
        { funnelStage: "TOFU", topic: "problem_challenge_identification", confidence: 0.93 },
        { funnelStage: "TOFU", topic: "digital_transformation_modernization", confidence: 0.87 },
        { funnelStage: "MOFU", topic: "product_capability_deepdive", confidence: 0.84 },
      ],
    },
    {
      id: "call_22", organizationId: ids.org3, accountId: ids.acc_fourthcoffee,
      title: "Fourth Coffee - Competitive Bake-Off Results", provider: "GONG", duration: 1800, occurredAt: daysAgo(45),
      hostUserId: ids.user_iris, contactId: "con_david",
      transcript: `David Kim: We ran the bake-off between your platform and two others. Your personalization engine outperformed by a significant margin.\n\nIris Kim: Great to hear. What metrics were you evaluating?\n\nDavid Kim: Offer relevance score, prediction accuracy, and time-to-insight. Your platform scored 87% on offer relevance versus 72% and 65% for the others. The real-time capability was the differentiator.\n\nIris Kim: Our event-streaming architecture makes a big difference. Most competitors batch-process overnight, which means their recommendations are always a day behind.\n\nDavid Kim: We noticed that. When a customer buys a latte at 8 AM, your system adjusts the afternoon offer in real-time. The others wouldn't update until the next morning.\n\nIris Kim: Exactly. In F&B, timing is everything.`,
      tags: [
        { funnelStage: "MOFU", topic: "competitive_displacement", confidence: 0.95 },
        { funnelStage: "BOFU", topic: "vendor_selection_criteria", confidence: 0.88 },
      ],
    },
    {
      id: "call_23", organizationId: ids.org3, accountId: ids.acc_fourthcoffee,
      title: "Fourth Coffee - Launch Review & Expansion", provider: "GONG", duration: 1500, occurredAt: daysAgo(5),
      hostUserId: ids.user_hank, contactId: "con_david",
      transcript: `David Kim: Month-one results are in. Active engagement is back up to 42% and we're seeing a 22% increase in average order value from members who receive personalized offers.\n\nHank Patel: Those numbers are strong, especially for the first month.\n\nDavid Kim: The gamification features have been particularly popular. The challenge system drove 180,000 incremental store visits last month.\n\nHank Patel: Have you considered expanding into the mobile ordering integration? That's where we see the biggest lift — combining loyalty with ordering.\n\nDavid Kim: That's phase two for us. We want to integrate the loyalty engine directly into our mobile app ordering flow. Can we start scoping that out?\n\nHank Patel: Absolutely. Our mobile SDK makes it straightforward. I'll have the solutions team prepare a proposal.`,
      tags: [
        { funnelStage: "POST_SALE", topic: "upsell_cross_sell_expansion", confidence: 0.93 },
        { funnelStage: "POST_SALE", topic: "customer_success_support", confidence: 0.84 },
      ],
    },

    // ── Initech Solutions / Lucerne Publishing (3 calls) ──
    {
      id: "call_24", organizationId: ids.org3, accountId: ids.acc_lucernepub,
      title: "Lucerne Publishing - Content Platform Modernization", provider: "FIREFLIES", duration: 2400, occurredAt: daysAgo(70),
      hostUserId: ids.user_iris, contactId: "con_maria",
      transcript: `Maria Garcia: Our content management system was built in 2015 and it's buckling under the load. We publish 2,000 articles per day across 14 brands and the editorial workflow is painful.\n\nIris Kim: Walk me through the current workflow.\n\nMaria Garcia: An article goes through 7 approval steps, each in a different tool. Writers use Google Docs, editors use a custom CMS, legal reviews in SharePoint, and social media scheduling in yet another tool. Average time from draft to publish is 4.5 days.\n\nIris Kim: That's a lot of context switching. Our unified editorial platform consolidates that into a single workspace with configurable approval workflows. Clients typically reduce publish time by 60-70%.\n\nMaria Garcia: If we could get that down to under 2 days, it would be transformative for our breaking news coverage.`,
      tags: [
        { funnelStage: "TOFU", topic: "problem_challenge_identification", confidence: 0.94 },
        { funnelStage: "VERTICAL", topic: "industry_specific_usecase", confidence: 0.90 },
      ],
    },
    {
      id: "call_25", organizationId: ids.org3, accountId: ids.acc_lucernepub,
      title: "Lucerne Publishing - AI Content Features Demo", provider: "FIREFLIES", duration: 3000, occurredAt: daysAgo(50),
      hostUserId: ids.user_jack, contactId: "con_maria",
      transcript: `Maria Garcia: Show me the AI features. Our editors are skeptical but curious.\n\nJack Rivera: Sure. Here's our AI-assisted editing suite. It does real-time fact-checking against your internal knowledge base, automated headline A/B testing, and SEO optimization suggestions.\n\nMaria Garcia: Can it handle our editorial style guide? We have very specific voice and tone requirements per brand.\n\nJack Rivera: You can train brand-specific AI profiles. Upload your style guide and a sample corpus, and the AI learns your brand voice. It then suggests edits that conform to each brand's standards.\n\nMaria Garcia: What about content repurposing? We want to turn long-form articles into social posts, newsletters, and video scripts.\n\nJack Rivera: One-click repurposing. Select an article, choose your output formats, and the AI generates drafts for each channel. Your social team can then fine-tune in the same platform.\n\nMaria Garcia: This would save our team dozens of hours per week. What does the implementation look like?`,
      tags: [
        { funnelStage: "MOFU", topic: "product_capability_deepdive", confidence: 0.96 },
        { funnelStage: "MOFU", topic: "customization_configurability", confidence: 0.88 },
      ],
    },
    {
      id: "call_26", organizationId: ids.org3, accountId: ids.acc_lucernepub,
      title: "Lucerne Publishing - Executive Sponsorship & Budget", provider: "FIREFLIES", duration: 1500, occurredAt: daysAgo(35),
      hostUserId: ids.user_hank, contactId: "con_maria",
      transcript: `Maria Garcia: I got the CEO on board. She's seen the demo and she's excited. Budget is approved for $450K annually.\n\nHank Patel: Excellent. That fits well within our enterprise tier which includes all AI features, 14 brand workspaces, and unlimited users.\n\nMaria Garcia: One concern from our CFO — what happens if we don't see the promised efficiency gains?\n\nHank Patel: We offer a 90-day value guarantee. If you don't see at least a 40% reduction in publish time within the first 90 days, we'll extend a free quarter while we optimize.\n\nMaria Garcia: That de-risks it significantly. Let's get the contract finalized. I want to start onboarding our largest brand first — Daily Ledger does 800 articles per day.`,
      tags: [
        { funnelStage: "BOFU", topic: "roi_financial_outcomes", confidence: 0.87 },
        { funnelStage: "BOFU", topic: "executive_strategic_impact", confidence: 0.91 },
        { funnelStage: "BOFU", topic: "risk_mitigation_continuity", confidence: 0.79 },
      ],
    },

    // ── Initech Solutions / Proseware (4 calls) ──
    {
      id: "call_27", organizationId: ids.org3, accountId: ids.acc_proseware,
      title: "Proseware - Developer Platform Strategy", provider: "ZOOM", duration: 2400, occurredAt: daysAgo(80),
      hostUserId: ids.user_hank, contactId: "con_chen",
      transcript: `Chen Wei: We have 1,200 engineers across 60 teams and our developer experience is atrocious. Average time to set up a new development environment is 3 days. Deployment takes 4 hours with manual approvals.\n\nHank Patel: Those numbers are unfortunately common in organizations your size. What's your current toolchain?\n\nChen Wei: Jenkins for CI, Kubernetes on-prem, GitLab for source control, and a custom deployment tool that nobody wants to maintain. Each team has slightly different configurations.\n\nHank Patel: The fragmentation is killing your velocity. Our developer platform standardizes the entire SDLC — from environment provisioning to production deployment — while still allowing team-level customization.\n\nChen Wei: How do you handle the political side? 60 teams all have opinions about their tools.\n\nHank Patel: We've navigated that in organizations with over 5,000 engineers. The key is providing a platform that's opinionated about infrastructure but flexible about developer workflow.`,
      tags: [
        { funnelStage: "TOFU", topic: "problem_challenge_identification", confidence: 0.92 },
        { funnelStage: "TOFU", topic: "digital_transformation_modernization", confidence: 0.86 },
        { funnelStage: "VERTICAL", topic: "company_size_segment", confidence: 0.80 },
      ],
    },
    {
      id: "call_28", organizationId: ids.org3, accountId: ids.acc_proseware,
      title: "Proseware - Platform Demo & Architecture Review", provider: "ZOOM", duration: 3600, occurredAt: daysAgo(60),
      hostUserId: ids.user_iris, contactId: "con_nina",
      transcript: `Nina Volkov: My team will be the pilot group. We're the platform team, so if we're happy, we can champion this across the organization.\n\nIris Kim: Smart approach. Let me show you the developer experience. Here's our environment provisioning — a developer clicks "New Environment" and gets a fully configured workspace in under 90 seconds. IDE, dependencies, database, everything.\n\nNina Volkov: 90 seconds? We currently measure that in days. What about our custom internal libraries?\n\nIris Kim: You define environment templates that include your internal packages. When a developer provisions an environment, it comes pre-loaded with the right versions.\n\nNina Volkov: And the CI/CD pipeline?\n\nIris Kim: Fully integrated. Push to main triggers build, test, security scan, and deployment. The entire pipeline runs in under 8 minutes for a typical microservice.\n\nNina Volkov: Our current pipeline takes 45 minutes to an hour. This would be a massive improvement.`,
      tags: [
        { funnelStage: "MOFU", topic: "product_capability_deepdive", confidence: 0.97 },
        { funnelStage: "MOFU", topic: "implementation_onboarding", confidence: 0.85 },
      ],
    },
    {
      id: "call_29", organizationId: ids.org3, accountId: ids.acc_proseware,
      title: "Proseware - Pilot Results & Expansion Plan", provider: "ZOOM", duration: 2100, occurredAt: daysAgo(30),
      hostUserId: ids.user_hank, contactId: "con_chen",
      transcript: `Chen Wei: Nina's team has been on the platform for 4 weeks and the metrics are stunning. Environment setup went from 3 days to 2 minutes. Deployment time from 4 hours to 12 minutes.\n\nHank Patel: What's the developer satisfaction feedback?\n\nChen Wei: We surveyed the pilot team — NPS went from -12 to +67. Engineers are actually excited about infrastructure for the first time.\n\nHank Patel: That's a tremendous improvement. How are you thinking about the rollout?\n\nChen Wei: We want to onboard 10 teams per month over the next 6 months. The platform team will serve as internal champions and provide first-line support.\n\nHank Patel: We'll pair your platform team with our customer success engineers for the first three months. They'll do weekly office hours and help with any edge cases.\n\nChen Wei: Perfect. One more thing — we want to explore your analytics module. Understanding developer productivity metrics across 60 teams would be invaluable.`,
      tags: [
        { funnelStage: "POST_SALE", topic: "scaling_across_org", confidence: 0.94 },
        { funnelStage: "POST_SALE", topic: "change_management_champion_dev", confidence: 0.89 },
        { funnelStage: "POST_SALE", topic: "upsell_cross_sell_expansion", confidence: 0.83 },
      ],
    },
    {
      id: "call_30", organizationId: ids.org3, accountId: ids.acc_proseware,
      title: "Proseware - Internal Sales Enablement Review", provider: "ZOOM", duration: 1500, occurredAt: daysAgo(7),
      hostUserId: ids.user_iris, contactId: "con_chen",
      transcript: `Iris Kim: We'd love to use Proseware as a reference story for our enterprise pipeline. The metrics from your deployment are exactly what CTOs want to hear.\n\nChen Wei: We're open to it, but with guardrails. I'd want to approve the specific data points and quotes before publication.\n\nIris Kim: Absolutely. We never publish without customer approval. Would you also be willing to take a couple of reference calls per quarter?\n\nChen Wei: Up to two per quarter, and I want at least a week's notice. I'll also loop in Nina — she can speak to the technical implementation.\n\nIris Kim: That's perfect. Having both the strategic and technical perspectives makes for a much stronger reference. We'll draft the case study and send it for your review.`,
      tags: [
        { funnelStage: "INTERNAL", topic: "sales_enablement", confidence: 0.92 },
        { funnelStage: "INTERNAL", topic: "reference_ability_development", confidence: 0.96 },
        { funnelStage: "INTERNAL", topic: "deal_anatomy", confidence: 0.74 },
      ],
    },
  ];
}

async function seedCalls() {
  const calls = buildCalls();

  for (const c of calls) {
    // Create call
    await prisma.call.upsert({
      where: { id: c.id },
      update: {},
      create: {
        id: c.id,
        organizationId: c.organizationId,
        accountId: c.accountId,
        title: c.title,
        provider: c.provider as any,
        duration: c.duration,
        occurredAt: c.occurredAt,
        updatedAt: now,
      },
    });

    // Create participants
    const hostParticipantId = `${c.id}_host`;
    const contactParticipantId = `${c.id}_contact`;

    await prisma.callParticipant.upsert({
      where: { id: hostParticipantId },
      update: {},
      create: {
        id: hostParticipantId,
        callId: c.id,
        name: "Host",
        isHost: true,
      },
    });

    await prisma.callParticipant.upsert({
      where: { id: contactParticipantId },
      update: {},
      create: {
        id: contactParticipantId,
        callId: c.id,
        contactId: c.contactId,
        name: "Contact",
        isHost: false,
      },
    });

    // Create transcript
    const transcriptId = `tx_${c.id}`;
    const words = c.transcript.split(/\s+/).length;

    await prisma.transcript.upsert({
      where: { callId: c.id },
      update: {},
      create: {
        id: transcriptId,
        callId: c.id,
        fullText: c.transcript,
        language: "en",
        wordCount: words,
      },
    });

    // Create transcript chunks (split by speaker turn)
    const turns = c.transcript.split("\n\n").filter(Boolean);
    for (let i = 0; i < turns.length; i++) {
      const chunkId = `chunk_${c.id}_${i}`;
      const speakerMatch = turns[i].match(/^([^:]+):/);
      const speaker = speakerMatch ? speakerMatch[1].trim() : null;
      const startMs = i * (c.duration * 1000 / turns.length);
      const endMs = (i + 1) * (c.duration * 1000 / turns.length);

      await prisma.transcriptChunk.upsert({
        where: { transcriptId_chunkIndex: { transcriptId, chunkIndex: i } },
        update: {},
        create: {
          id: chunkId,
          transcriptId,
          chunkIndex: i,
          text: turns[i],
          speaker,
          startMs: Math.round(startMs),
          endMs: Math.round(endMs),
          embeddingId: `emb_${c.id}_${i}`,
        },
      });
    }

    // Create call tags
    for (const tag of c.tags) {
      const tagId = `tag_${c.id}_${tag.funnelStage}_${tag.topic}`;
      await prisma.callTag.upsert({
        where: { callId_funnelStage_topic: { callId: c.id, funnelStage: tag.funnelStage as any, topic: tag.topic } },
        update: {},
        create: {
          id: tagId,
          callId: c.id,
          funnelStage: tag.funnelStage as any,
          topic: tag.topic,
          confidence: tag.confidence,
        },
      });
    }
  }
}

// ─── Seed: Salesforce Events ─────────────────────────────────────────────────

async function seedSalesforceEvents() {
  const events = [
    { id: "sfe_01", accountId: ids.acc_meridian, eventType: "OPPORTUNITY_CREATED" as const, stageName: "Prospecting", opportunityId: "opp_meridian_001", amount: 480000, description: "Initial health data platform opportunity" },
    { id: "sfe_02", accountId: ids.acc_meridian, eventType: "OPPORTUNITY_STAGE_CHANGE" as const, stageName: "Proposal", opportunityId: "opp_meridian_001", amount: 480000, description: "Moved to proposal after technical deep dive" },
    { id: "sfe_03", accountId: ids.acc_meridian, eventType: "CLOSED_WON" as const, stageName: "Closed Won", opportunityId: "opp_meridian_001", amount: 520000, closeDate: daysAgo(55), description: "Signed 2-year contract with expansion clause" },
    { id: "sfe_04", accountId: ids.acc_contoso, eventType: "OPPORTUNITY_CREATED" as const, stageName: "Discovery", opportunityId: "opp_contoso_001", amount: 750000, description: "IoT manufacturing platform opportunity" },
    { id: "sfe_05", accountId: ids.acc_contoso, eventType: "CLOSED_WON" as const, stageName: "Closed Won", opportunityId: "opp_contoso_001", amount: 920000, closeDate: daysAgo(8), description: "Full factory deployment approved by board" },
    { id: "sfe_06", accountId: ids.acc_fabrikam, eventType: "OPPORTUNITY_CREATED" as const, stageName: "Qualification", opportunityId: "opp_fabrikam_001", amount: 1200000, description: "Security platform consolidation" },
    { id: "sfe_07", accountId: ids.acc_fourthcoffee, eventType: "OPPORTUNITY_CREATED" as const, stageName: "Prospecting", opportunityId: "opp_4thcoffee_001", amount: 360000, description: "Loyalty platform replacement" },
    { id: "sfe_08", accountId: ids.acc_fourthcoffee, eventType: "CLOSED_WON" as const, stageName: "Closed Won", opportunityId: "opp_4thcoffee_001", amount: 385000, closeDate: daysAgo(20), description: "Annual contract with mobile SDK add-on" },
    { id: "sfe_09", accountId: ids.acc_lucernepub, eventType: "OPPORTUNITY_CREATED" as const, stageName: "Discovery", opportunityId: "opp_lucerne_001", amount: 450000, description: "Editorial platform modernization" },
    { id: "sfe_10", accountId: ids.acc_proseware, eventType: "OPPORTUNITY_CREATED" as const, stageName: "Evaluation", opportunityId: "opp_proseware_001", amount: 1800000, description: "Enterprise developer platform" },
    { id: "sfe_11", accountId: ids.acc_proseware, eventType: "OPPORTUNITY_STAGE_CHANGE" as const, stageName: "Negotiation", opportunityId: "opp_proseware_001", amount: 2100000, description: "Expanded scope to include analytics module" },
    { id: "sfe_12", accountId: ids.acc_proseware, eventType: "CLOSED_WON" as const, stageName: "Closed Won", opportunityId: "opp_proseware_001", amount: 2100000, closeDate: daysAgo(25), description: "3-year enterprise agreement with 60-team rollout" },
  ];

  for (const e of events) {
    await prisma.salesforceEvent.upsert({
      where: { id: e.id },
      update: {},
      create: e,
    });
  }
}

// ─── Seed: Stories & Quotes ──────────────────────────────────────────────────

async function seedStories() {
  const stories = [
    {
      id: "story_meridian",
      organizationId: ids.org1,
      accountId: ids.acc_meridian,
      title: "Meridian Health: From Data Fragmentation to 62% Faster Clinical Workflows",
      storyType: "FULL_JOURNEY" as const,
      funnelStages: ["TOFU", "MOFU", "BOFU", "POST_SALE"] as any[],
      filterTags: ["problem_challenge_identification", "integration_interoperability", "roi_financial_outcomes"],
      markdownBody: `# Meridian Health Systems: A Complete Journey\n\n## The Challenge\nMeridian Health, a 14-hospital system with 12,000 employees, was drowning in fragmented patient data. Clinicians wasted 30 minutes per shift searching for records, and the IT team spent 60% of their time maintaining a legacy Epic integration.\n\n## The Evaluation\nAfter a thorough technical evaluation focusing on HL7 FHIR compliance and HIPAA requirements, Meridian selected our platform for its native compliance capabilities and aggressive 12-week implementation timeline.\n\n## The Results\n- **62% reduction** in clinician search time (exceeding the 50% target)\n- **45% decrease** in IT maintenance hours\n- **$2.4M** in projected annual savings\n- **94%** on-time deployment track record confirmed\n\n## What's Next\nMeridian is expanding to 22 outpatient clinics, extending the platform's reach across their entire care network.`,
      quotes: [
        { id: "q_01", speaker: "Sarah Jones", quoteText: "The results have exceeded our expectations. Clinician search time is down 62%, not the 50% we targeted.", context: "90-day success review", metricType: "time_saved", metricValue: "62%" },
        { id: "q_02", speaker: "Sarah Jones", quoteText: "IT maintenance hours dropped by 45%. Mike's team is actually working on new projects for the first time in two years.", context: "Post-implementation review", metricType: "cost_savings", metricValue: "45%" },
        { id: "q_03", speaker: "Sarah Jones", quoteText: "We're talking about potential savings of $2.4 million annually.", context: "Initial discovery call", metricType: "cost_savings", metricValue: "$2.4M" },
      ],
    },
    {
      id: "story_contoso",
      organizationId: ids.org1,
      accountId: ids.acc_contoso,
      title: "Contoso Manufacturing: $2.5M in Avoided Downtime in Just 3 Weeks",
      storyType: "ROI_ANALYSIS" as const,
      funnelStages: ["TOFU", "MOFU", "BOFU"] as any[],
      filterTags: ["industry_trend_validation", "product_capability_deepdive", "quantified_operational_metrics"],
      markdownBody: `# Contoso: IoT-Powered Predictive Manufacturing\n\n## The Opportunity\nWith 340 production lines across 8 factories, Contoso was only analyzing 5% of their sensor data. The remaining 95% was being discarded before anyone could act on it.\n\n## The Solution\nOur edge computing IoT gateway pre-processes data at the factory level, reducing data transfer by 85% while enabling sub-second anomaly detection.\n\n## The Proof\nA 3-week pilot on Line 7 detected 14 anomalies that would have caused unplanned downtime. At $180,000 per incident, that's **$2.5 million in avoided costs** from a single production line.\n\n## The Decision\nThe board approved full deployment across all 8 factories within 24 hours of seeing the pilot results.`,
      quotes: [
        { id: "q_04", speaker: "Raj Patel", quoteText: "We detected 14 anomalies that would have caused unplanned downtime. We're looking at $2.5 million in avoided downtime in just three weeks on one production line.", context: "Pilot results review", metricType: "cost_savings", metricValue: "$2.5M" },
        { id: "q_05", speaker: "Raj Patel", quoteText: "The board approved full deployment yesterday. We want to roll out to all 8 factories by end of year.", context: "Executive metrics review", metricType: "revenue", metricValue: "8 factories" },
      ],
    },
    {
      id: "story_proseware",
      organizationId: ids.org3,
      accountId: ids.acc_proseware,
      title: "Proseware: From 3-Day Setup to 2 Minutes — Transforming Developer Experience at Scale",
      storyType: "FULL_JOURNEY" as const,
      funnelStages: ["TOFU", "MOFU", "POST_SALE"] as any[],
      filterTags: ["problem_challenge_identification", "product_capability_deepdive", "scaling_across_org"],
      markdownBody: `# Proseware: Developer Platform Transformation\n\n## The Pain\n1,200 engineers across 60 teams suffered from a fragmented toolchain. Environment setup took 3 days. Deployments took 4 hours. Developer NPS was -12.\n\n## The Platform\nA unified developer platform that standardizes the SDLC while preserving team-level flexibility. Environment provisioning in 90 seconds. Full CI/CD pipeline in under 8 minutes.\n\n## The Transformation\n- **Environment setup**: 3 days → 2 minutes\n- **Deployment time**: 4 hours → 12 minutes\n- **Developer NPS**: -12 → +67\n- **Rollout plan**: 10 teams per month over 6 months\n\n## The Champion Model\nThe platform team serves as internal champions, providing first-line support during the 60-team rollout.`,
      quotes: [
        { id: "q_06", speaker: "Chen Wei", quoteText: "Environment setup went from 3 days to 2 minutes. Deployment time from 4 hours to 12 minutes.", context: "Pilot results presentation", metricType: "time_saved", metricValue: "99.95%" },
        { id: "q_07", speaker: "Chen Wei", quoteText: "We surveyed the pilot team — NPS went from -12 to +67. Engineers are actually excited about infrastructure for the first time.", context: "Pilot expansion discussion", metricType: "revenue", metricValue: "+79 NPS" },
      ],
    },
    {
      id: "story_wideworldimporters",
      organizationId: ids.org2,
      accountId: ids.acc_wideworldimporters,
      title: "Wide World Importers: $18M Annual Savings Through Supply Chain Visibility",
      storyType: "ROI_ANALYSIS" as const,
      funnelStages: ["TOFU", "BOFU", "POST_SALE"] as any[],
      filterTags: ["problem_challenge_identification", "roi_financial_outcomes", "training_enablement_adoption"],
      markdownBody: `# Wide World Importers: Real-Time Supply Chain Visibility\n\n## Before\n- Zero real-time visibility across 23 countries\n- $4.2M quarterly spoilage from undetected temperature excursions\n- No predictive ETA capability\n\n## After\n- Real-time digital twin for every shipment\n- Caught 3 temperature excursions in pilot, saving $890K\n- 94% ETA accuracy within 2-hour windows\n- 85% daily active usage among logistics coordinators\n\n## The Numbers\n**$18 million** projected annual spoilage reduction — a 4x ROI on platform cost.`,
      quotes: [
        { id: "q_08", speaker: "James Brown", quoteText: "We caught three temperature excursions in real-time and rerouted the containers before any spoilage occurred. About $890,000 in product that would have been lost.", context: "Pilot results review", metricType: "cost_savings", metricValue: "$890K" },
        { id: "q_09", speaker: "James Brown", quoteText: "The CFO ran the numbers — she's projecting $18 million in annual spoilage reduction. That's a 4x ROI on the platform cost.", context: "Full deployment discussion", metricType: "cost_savings", metricValue: "$18M" },
      ],
    },
    {
      id: "story_fourthcoffee",
      organizationId: ids.org3,
      accountId: ids.acc_fourthcoffee,
      title: "Fourth Coffee: Reviving a 12M-Member Loyalty Program with AI Personalization",
      storyType: "COMPETITIVE_WIN" as const,
      funnelStages: ["TOFU", "MOFU", "POST_SALE"] as any[],
      filterTags: ["digital_transformation_modernization", "competitive_displacement", "customer_success_support"],
      markdownBody: `# Fourth Coffee: Loyalty Reinvented\n\n## The Decline\nFourth Coffee's 12-million member loyalty program saw monthly active engagement drop from 45% to 31% over 12 months. The legacy platform couldn't support personalization, gamification, or tiered rewards.\n\n## The Bake-Off\nIn a competitive evaluation, our personalization engine scored 87% on offer relevance versus 72% and 65% for competitors. The real-time event-streaming architecture was the key differentiator.\n\n## Month One Results\n- **Active engagement**: 31% → 42% (+35% improvement)\n- **Average order value**: +22% for personalized offers\n- **Gamification impact**: 180,000 incremental store visits\n\n## Next Phase\nMobile ordering integration to combine loyalty with the ordering flow.`,
      quotes: [
        { id: "q_10", speaker: "David Kim", quoteText: "Month-one results are in. Active engagement is back up to 42% and we're seeing a 22% increase in average order value.", context: "Launch review", metricType: "revenue", metricValue: "+22% AOV" },
        { id: "q_11", speaker: "David Kim", quoteText: "The challenge system drove 180,000 incremental store visits last month.", context: "Launch review", metricType: "revenue", metricValue: "180K visits" },
      ],
    },
  ];

  for (const s of stories) {
    const { quotes, ...storyData } = s;

    await prisma.story.upsert({
      where: { id: s.id },
      update: {},
      create: {
        ...storyData,
        updatedAt: now,
      },
    });

    for (const q of quotes) {
      await prisma.highValueQuote.upsert({
        where: { id: q.id },
        update: {},
        create: { ...q, storyId: s.id },
      });
    }
  }
}

// ─── Seed: Landing Pages (5 in various states) ──────────────────────────────

async function seedLandingPages() {
  const pages = [
    {
      id: "lp_meridian_published",
      organizationId: ids.org1,
      storyId: "story_meridian",
      createdById: ids.user_alice,
      slug: "meridian-health-journey",
      title: "How Meridian Health Cut Clinical Search Time by 62%",
      subtitle: "A 14-hospital system's path from fragmented data to unified patient records",
      editableBody: "# Meridian Health: The Journey\n\nThis healthcare system transformed their clinical workflows...",
      scrubbedBody: "# The Client: The Journey\n\nThis healthcare system transformed their clinical workflows...",
      heroImageUrl: "https://images.unsplash.com/photo-1538108149393-fbbd81895907",
      calloutBoxes: JSON.stringify([
        { title: "62%", body: "Reduction in search time", icon: "clock" },
        { title: "$2.4M", body: "Annual savings", icon: "dollar" },
        { title: "12 weeks", body: "Implementation timeline", icon: "calendar" },
      ]),
      totalCallHours: 3.08,
      visibility: "SHARED_WITH_LINK" as const,
      status: "PUBLISHED" as const,
      includeCompanyName: true,
      noIndex: false,
      viewCount: 147,
      publishedAt: daysAgo(10),
    },
    {
      id: "lp_contoso_published",
      organizationId: ids.org1,
      storyId: "story_contoso",
      createdById: ids.user_bob,
      slug: "manufacturing-iot-roi",
      title: "$2.5M Saved in 3 Weeks: An IoT Manufacturing Story",
      subtitle: "How predictive maintenance transformed factory operations",
      editableBody: "# Manufacturing IoT: The ROI Story\n\nWhen a global manufacturer deployed IoT sensors...",
      scrubbedBody: "# Manufacturing IoT: The ROI Story\n\nWhen a global manufacturer deployed IoT sensors...",
      calloutBoxes: JSON.stringify([
        { title: "$2.5M", body: "Avoided downtime costs", icon: "shield" },
        { title: "14", body: "Anomalies detected in pilot", icon: "alert" },
        { title: "85%", body: "Data transfer reduction", icon: "trending-down" },
      ]),
      totalCallHours: 1.75,
      visibility: "SHARED_WITH_LINK" as const,
      status: "PUBLISHED" as const,
      password: "contoso2025",
      includeCompanyName: false,
      noIndex: true,
      viewCount: 42,
      publishedAt: daysAgo(5),
    },
    {
      id: "lp_proseware_draft",
      organizationId: ids.org3,
      storyId: "story_proseware",
      createdById: ids.user_hank,
      slug: "developer-platform-transformation",
      title: "From 3 Days to 2 Minutes: A Developer Platform Story",
      subtitle: "Transforming developer experience across 60 engineering teams",
      editableBody: "# Developer Platform Transformation\n\n## Draft — needs review\n\nThis story covers...",
      scrubbedBody: "# Developer Platform Transformation\n\n## Draft — needs review\n\nThis story covers...",
      totalCallHours: 2.67,
      visibility: "PRIVATE" as const,
      status: "DRAFT" as const,
      includeCompanyName: false,
      noIndex: true,
      viewCount: 0,
    },
    {
      id: "lp_wideworldimporters_draft",
      organizationId: ids.org2,
      storyId: "story_wideworldimporters",
      createdById: ids.user_eve,
      slug: "supply-chain-visibility-roi",
      title: "$18M in Annual Savings Through Supply Chain Visibility",
      subtitle: "How real-time tracking eliminated spoilage across 23 countries",
      editableBody: "# Supply Chain Visibility\n\n## Work in progress\n\nReal-time shipment monitoring...",
      scrubbedBody: "# Supply Chain Visibility\n\n## Work in progress\n\nReal-time shipment monitoring...",
      totalCallHours: 1.92,
      visibility: "PRIVATE" as const,
      status: "DRAFT" as const,
      includeCompanyName: false,
      noIndex: true,
      viewCount: 0,
    },
    {
      id: "lp_fourthcoffee_archived",
      organizationId: ids.org3,
      storyId: "story_fourthcoffee",
      createdById: ids.user_iris,
      slug: "loyalty-program-revival",
      title: "Reviving a 12M-Member Loyalty Program",
      subtitle: "AI-powered personalization drives 35% engagement lift",
      editableBody: "# Loyalty Reinvented\n\nThis case study was archived after the customer requested revisions...",
      scrubbedBody: "# Loyalty Reinvented\n\nThis case study was archived after the customer requested revisions...",
      totalCallHours: 1.50,
      visibility: "PRIVATE" as const,
      status: "ARCHIVED" as const,
      includeCompanyName: false,
      noIndex: true,
      viewCount: 23,
      publishedAt: daysAgo(30),
    },
  ];

  for (const p of pages) {
    await prisma.landingPage.upsert({
      where: { id: p.id },
      update: {},
      create: { ...p, updatedAt: now },
    });
  }

  // Add edit history for published pages
  const edits = [
    {
      id: "edit_01",
      landingPageId: "lp_meridian_published",
      editedById: ids.user_alice,
      previousBody: "# Meridian Health: Initial Draft\n\nPlaceholder content...",
      newBody: "# Meridian Health: The Journey\n\nThis healthcare system transformed their clinical workflows...",
      editSummary: "Replaced placeholder with full story content",
    },
    {
      id: "edit_02",
      landingPageId: "lp_meridian_published",
      editedById: ids.user_bob,
      previousBody: "# Meridian Health: The Journey\n\nThis healthcare system transformed their clinical workflows...",
      newBody: "# Meridian Health: The Journey\n\nThis healthcare system transformed their clinical workflows... (updated with Q4 metrics)",
      editSummary: "Added Q4 metrics and updated timeline",
    },
    {
      id: "edit_03",
      landingPageId: "lp_contoso_published",
      editedById: ids.user_bob,
      previousBody: "# Manufacturing IoT: Draft\n\nPending...",
      newBody: "# Manufacturing IoT: The ROI Story\n\nWhen a global manufacturer deployed IoT sensors...",
      editSummary: "Full rewrite with pilot results data",
    },
  ];

  for (const e of edits) {
    await prisma.landingPageEdit.upsert({
      where: { id: e.id },
      update: {},
      create: e,
    });
  }
}

// ─── Seed: Org Settings ──────────────────────────────────────────────────────

async function seedOrgSettings() {
  const settings = [
    {
      id: "osettings_acme",
      organizationId: ids.org1,
      landingPagesEnabled: true,
      defaultPageVisibility: "PRIVATE" as const,
      requireApprovalToPublish: false,
      allowedPublishers: ["OWNER", "ADMIN"] as any[],
      maxPagesPerUser: null,
      companyNameReplacements: { "Acme Corp": "our team", "Acme": "our team" },
    },
    {
      id: "osettings_globex",
      organizationId: ids.org2,
      landingPagesEnabled: true,
      defaultPageVisibility: "PRIVATE" as const,
      requireApprovalToPublish: true,
      allowedPublishers: ["OWNER"] as any[],
      maxPagesPerUser: 5,
      companyNameReplacements: { "Globex Inc": "the vendor", "Globex": "the vendor" },
    },
    {
      id: "osettings_initech",
      organizationId: ids.org3,
      landingPagesEnabled: true,
      defaultPageVisibility: "SHARED_WITH_LINK" as const,
      requireApprovalToPublish: false,
      allowedPublishers: ["OWNER", "ADMIN", "MEMBER"] as any[],
      maxPagesPerUser: null,
      companyNameReplacements: { "Initech Solutions": "our company", "Initech": "our company" },
    },
  ];

  for (const s of settings) {
    await prisma.orgSettings.upsert({
      where: { organizationId: s.organizationId },
      update: {},
      create: { ...s, updatedAt: now },
    });
  }
}

// ─── Seed: Full Permission Matrix ────────────────────────────────────────────

async function seedPermissions() {
  // Define the full permission matrix:
  // OWNER  → all permissions
  // ADMIN  → all except MANAGE_PERMISSIONS
  // MEMBER → CREATE + PUBLISH + VIEW_ANALYTICS
  // VIEWER → VIEW_ANALYTICS only

  const allPerms = [
    "CREATE_LANDING_PAGE",
    "PUBLISH_LANDING_PAGE",
    "PUBLISH_NAMED_LANDING_PAGE",
    "EDIT_ANY_LANDING_PAGE",
    "DELETE_ANY_LANDING_PAGE",
    "MANAGE_PERMISSIONS",
    "VIEW_ANALYTICS",
  ] as const;

  const rolePerms: Record<string, readonly string[]> = {
    OWNER: allPerms,
    ADMIN: ["CREATE_LANDING_PAGE", "PUBLISH_LANDING_PAGE", "PUBLISH_NAMED_LANDING_PAGE", "EDIT_ANY_LANDING_PAGE", "DELETE_ANY_LANDING_PAGE", "VIEW_ANALYTICS"],
    MEMBER: ["CREATE_LANDING_PAGE", "PUBLISH_LANDING_PAGE", "VIEW_ANALYTICS"],
    VIEWER: ["VIEW_ANALYTICS"],
  };

  const users = [
    { id: ids.user_alice, role: "OWNER", orgId: ids.org1 },
    { id: ids.user_bob, role: "ADMIN", orgId: ids.org1 },
    { id: ids.user_carol, role: "MEMBER", orgId: ids.org1 },
    { id: ids.user_dave, role: "VIEWER", orgId: ids.org1 },
    { id: ids.user_eve, role: "OWNER", orgId: ids.org2 },
    { id: ids.user_frank, role: "MEMBER", orgId: ids.org2 },
    { id: ids.user_grace, role: "VIEWER", orgId: ids.org2 },
    { id: ids.user_hank, role: "OWNER", orgId: ids.org3 },
    { id: ids.user_iris, role: "ADMIN", orgId: ids.org3 },
    { id: ids.user_jack, role: "MEMBER", orgId: ids.org3 },
  ];

  let permIdx = 0;
  for (const user of users) {
    const perms = rolePerms[user.role] ?? [];
    for (const perm of perms) {
      permIdx++;
      const permId = `perm_${String(permIdx).padStart(3, "0")}`;
      // grantedById: owners grant their own, others granted by the org owner
      const grantedById = user.role === "OWNER" ? user.id : users.find((u) => u.orgId === user.orgId && u.role === "OWNER")!.id;

      await prisma.userPermission.upsert({
        where: { userId_permission: { userId: user.id, permission: perm as any } },
        update: {},
        create: {
          id: permId,
          userId: user.id,
          permission: perm as any,
          grantedById,
        },
      });
    }
  }
}

// ─── Seed: Account Access Control ────────────────────────────────────────────

async function seedAccountAccess() {
  const accessRules = [
    // Acme Corp
    { id: "uaa_01", userId: ids.user_alice, organizationId: ids.org1, scopeType: "ALL_ACCOUNTS" as const },
    { id: "uaa_02", userId: ids.user_bob, organizationId: ids.org1, scopeType: "ALL_ACCOUNTS" as const },
    { id: "uaa_03", userId: ids.user_carol, organizationId: ids.org1, scopeType: "ACCOUNT_LIST" as const, cachedAccountIds: [ids.acc_meridian, ids.acc_northwind] },
    { id: "uaa_04", userId: ids.user_dave, organizationId: ids.org1, scopeType: "SINGLE_ACCOUNT" as const, accountId: ids.acc_meridian },
    // Globex Inc
    { id: "uaa_05", userId: ids.user_eve, organizationId: ids.org2, scopeType: "ALL_ACCOUNTS" as const },
    { id: "uaa_06", userId: ids.user_frank, organizationId: ids.org2, scopeType: "ACCOUNT_LIST" as const, cachedAccountIds: [ids.acc_adventureworks, ids.acc_tailspintoys] },
    { id: "uaa_07", userId: ids.user_grace, organizationId: ids.org2, scopeType: "SINGLE_ACCOUNT" as const, accountId: ids.acc_wideworldimporters },
    // Initech Solutions
    { id: "uaa_08", userId: ids.user_hank, organizationId: ids.org3, scopeType: "ALL_ACCOUNTS" as const },
    { id: "uaa_09", userId: ids.user_iris, organizationId: ids.org3, scopeType: "ALL_ACCOUNTS" as const },
    { id: "uaa_10", userId: ids.user_jack, organizationId: ids.org3, scopeType: "CRM_REPORT" as const, crmReportId: "00O5f000005XrPz", crmProvider: "SALESFORCE" as const, crmReportName: "West Coast Enterprise Accounts", cachedAccountIds: [ids.acc_proseware, ids.acc_fourthcoffee] },
  ];

  for (const rule of accessRules) {
    await prisma.userAccountAccess.upsert({
      where: { id: rule.id },
      update: {},
      create: {
        ...rule,
        grantedById: rule.scopeType === "ALL_ACCOUNTS" ? rule.userId : undefined,
        updatedAt: now,
      },
    });
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱 Seeding StoryEngine database...\n");

  console.log("  → Organizations...");
  await seedOrganizations();

  console.log("  → Users...");
  await seedUsers();

  console.log("  → CRM Accounts...");
  await seedAccounts();

  console.log("  → Contacts...");
  await seedContacts();

  console.log("  → Calls, Transcripts & Tags (30 calls)...");
  await seedCalls();

  console.log("  → Salesforce Events...");
  await seedSalesforceEvents();

  console.log("  → Stories & Quotes...");
  await seedStories();

  console.log("  → Landing Pages (5 pages)...");
  await seedLandingPages();

  console.log("  → Org Settings...");
  await seedOrgSettings();

  console.log("  → Permissions (full matrix)...");
  await seedPermissions();

  console.log("  → Account Access Control...");
  await seedAccountAccess();

  console.log("\n✅ Seed complete!");
  console.log("   3 organizations, 10 users, 10 accounts, 30 calls");
  console.log("   5 stories, 5 landing pages, full permission matrix");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
