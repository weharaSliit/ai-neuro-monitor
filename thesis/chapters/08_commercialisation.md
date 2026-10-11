# Commercialisation and Sustainability

## Value Proposition and Target Users

MindPulse offers stress awareness that is personal, low-cost and understandable. The ring is built from inexpensive off-the-shelf parts, and each reading is judged against the wearer's own calibrated normal range and not an average. The principal target users are university students and young professionals who face study or workplace pressure; secondary users are wellness and counselling services, employers running wellbeing programmes, and researchers who need an open, inspectable pipeline. [[TODO: add two or three user personas and, if you have them, the needs you heard from real users.]]

## Market and Competitive Position

Consumer wearables and smart rings report stress or readiness scores, mostly from heart-rate variability, and a few include an electrodermal sensor; research-grade devices record electrodermal activity but are expensive and not designed for everyday wear. [[TODO: name the main products, cite their documentation or price pages, and summarise them in a table: sensors, personal baseline, personal threshold, price, openness.]] MindPulse differs by combining pulse and skin-conductance sensing in a finger-worn form, by personalising the decision point and not only the score, by validating its trend warning, and by being open for inspection. Its weaknesses are an early-stage prototype, a small validation sample and the open verification items of Section 5.4. [[TODO: add market size figures only from a cited report.]]

## Business or Sustainability Model

Three paths are plausible. A direct-to-consumer model would sell the ring at cost and a subscription for the application and history. A business-to-business model would offer the clinical view and anonymised team-level trends to universities and employers. A research-kit model would supply the ring, the open pipeline and the dashboard to laboratories. Costs are the bill of materials, hosting (currently free tiers, which would need paid tiers at scale), support and regulatory review. [[TODO: add the bill of materials with prices for the ring components and an estimated unit cost.]]

## Scalability, Intellectual Property and Compliance

**Scalability.** The services are stateless Flask applications and the data sit in a managed realtime database, so users can be added by scaling hosting; the free tier's cold start and the polling of the clinical view would need to be replaced by push updates and pagination at scale.

**Intellectual property.** The code uses open-source libraries whose licences permit this use [[TODO: list the main licences, for example Flask, scikit-learn, XGBoost, React]]; WESAD is available for research use under its own terms {{cite:wesad}}, so any commercial model should be retrained on data collected with consent. [[TODO: state whether a patent or registered design is planned.]]

**Compliance.** The system collects health-related personal data, so consent, minimisation and security matter. Only derived features and small processed previews are stored, passwords are hashed, and the service is positioned as wellbeing support, not as a medical device or diagnostic tool, which keeps it outside medical-device regulation while the wording makes clear it must not replace professional advice. [[TODO: add the relevant data-protection law, for example Sri Lanka's Personal Data Protection Act, No. 9 of 2022, and any ethics approval.]]

## Contribution to the Sustainable Development Goals

The work supports Sustainable Development Goal 3 (good health and well-being) by helping people notice and manage stress early, and Goal 9 (industry, innovation and infrastructure) through a low-cost, open sensing platform. It also relates to Goal 8 (decent work) where it supports workplace wellbeing programmes, and to Goal 4 (quality education) where it helps students manage pressure. Its environmental footprint is small, because the ring is built from few components, though battery disposal and device lifetime need attention in any product version.
