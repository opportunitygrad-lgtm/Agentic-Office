# Roadmap

The detailed, numbered plan lives in [BUILD_LEDGER.md](./BUILD_LEDGER.md).
This is the narrative view.

| Phase                     | Stages | Outcome                                                                                                                                 |
| ------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Foundation**         | 01     | Data model, API, worker, visual command centre, abstractions. ✅                                                                        |
| **2. Governed workforce** | 02–06  | Auth & RBAC, company knowledge, agent management, prompt library, task orchestration. Agents can be configured and receive work safely. |
| **3. Intelligence**       | 07–11  | Claude, OpenAI and Grok live behind one interface, a smart router and a Cost Governor that enforces budgets.                            |
| **4. Data & leads**       | 12–13  | Google Sheets/Drive, credential vault, lead management.                                                                                 |
| **5. Communications**     | 14–18  | Outlook/Graph, inbox monitoring, drafting, autonomy rules, follow-ups.                                                                  |
| **6. Marketing & ads**    | 19–23  | Meta connection, monitoring, Ad Library intelligence, campaign drafts, guarded execution.                                               |
| **7. Web presence**       | 24–28  | Website monitoring, GA4, Search Console, WordPress, SEO.                                                                                |
| **8. Browser agents**     | 29–32  | Playwright workers, persistent profiles, live mini-screen, human takeover.                                                              |
| **9. Governance & ops**   | 33–36  | Approval engine, audit system, notifications, research workspace & webhooks.                                                            |
| **10. Production**        | 37–40  | Deployment, backups, security hardening, final QA.                                                                                      |

Guiding rules: every external action is auditable; consequential actions need
approval until an explicit autonomy policy allows otherwise; providers remain
replaceable; each stage ships with tests and an updated ledger.
