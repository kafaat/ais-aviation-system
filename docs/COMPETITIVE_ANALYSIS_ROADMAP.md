# AIS Aviation System - Competitive Analysis & Roadmap

## Version 5.0 | February 2026

---

## 1. Executive Summary

This document provides a comprehensive competitive analysis of AIS (Aviation Integrated System) against global PSS (Passenger Service System) leaders, identifies critical gaps, and defines a phased implementation roadmap to achieve competitive parity with systems like Crane PSS (Hitit), SITA Horizon, Sabre SabreSonic, TravelSky, and Amadeus Altea.

**Current Score: 32/100** → **Target Score: 75/100** (within 36 months)

---

## 2. System Comparison Matrix

| Capability              | AIS                   | Crane PSS   | TravelSky   | Sabre       | SITA        | Amadeus     |
| ----------------------- | --------------------- | ----------- | ----------- | ----------- | ----------- | ----------- |
| GDS Integration         | ❌ → ✅ Phase 5       | ✅          | ✅          | ✅          | ✅          | ✅          |
| IATA NDC                | ❌ → ✅ Phase 5       | ✅          | In Progress | In Progress | ✅          | ✅          |
| ONE Order               | ❌ → Future           | ❌          | In Progress | In Progress | In Progress | ✅          |
| Inventory Control (ICS) | Basic → ✅ Enhanced   | ✅ Advanced | ✅ Advanced | ✅ Advanced | ✅ Advanced | ✅ Advanced |
| Codeshare/Interline     | ❌ → ✅ Phase 5       | ✅          | ✅          | ✅          | ✅          | ✅          |
| DCS (Complete)          | Partial → Enhanced    | ✅          | ✅          | ✅          | ✅          | ✅          |
| Revenue Management      | ✅ AI-Based           | ✅          | ✅          | ✅          | ✅          | ✅          |
| Cargo System            | ❌                    | ✅          | ✅          | ✅          | ❌          | ❌          |
| Payment Gateways        | Stripe                | Multi       | Multi       | Multi       | Multi       | Multi       |
| BSP/IATA Settlement     | Declared → ✅ Phase 5 | ✅          | ✅          | ✅          | ✅          | ✅          |
| Biometrics              | Declared → ✅ Phase 5 | ✅          | ✅          | ✅          | ✅          | ✅          |
| Self-Service Kiosks     | Declared → ✅ Phase 5 | ✅          | ✅          | ✅          | ✅          | ✅          |
| Loyalty Program         | Basic → Enhanced      | ✅          | ✅          | ✅          | Limited     | ✅          |
| AI Chatbot              | ✅                    | Limited     | Limited     | ✅          | Limited     | ✅          |
| Multi-language          | ✅ (AR/EN)            | ✅          | ✅          | ✅          | ✅          | ✅          |
| Weight & Balance        | Declared → ✅ Phase 5 | ✅          | ✅          | ✅          | ✅          | ✅          |
| EMD Support             | ❌ → ✅ Phase 5       | ✅          | ✅          | ✅          | ✅          | ✅          |
| Complex Fares           | ❌ → ✅ Phase 5       | ✅          | ✅          | ✅          | ✅          | ✅          |
| Seat Maps/Selection     | ❌ → ✅ Phase 5       | ✅          | ✅          | ✅          | ✅          | ✅          |
| Tech Stack              | Modern                | Modern      | Hybrid      | Hybrid      | Hybrid      | Hybrid      |
| Airlines Served         | 0                     | 60+         | 350+        | 100+        | 200+        | 400+        |

---

## 3. Gap Analysis by Domain

### 3.1 Distribution (Critical Gap - Score: 1/10)

**Current State:** No GDS/NDC connectivity. System operates in isolation.

**What's Missing:**

- No IATA NDC (New Distribution Capability) endpoints
- No GDS integration (Amadeus, Sabre, Travelport)
- No EDIFACT/traditional distribution messaging
- No B2B API for wholesale partners

**Impact:** Without distribution connectivity, AIS cannot participate in the global aviation ecosystem. Airlines cannot sell through travel agencies or OTAs.

**Phase 5 Solution:** NDC API Gateway + GDS Integration Layer

### 3.2 Fare Management (Critical Gap - Score: 2/10)

**Current State:** Simple economy/business pricing. No fare classes, no complex fare rules.

**What's Missing:**

- No RBD (Reservation Booking Designators) - L, H, U, M, etc.
- No fare rules engine (advance purchase, min stay, blackout dates)
- No currency surcharges (YQ/YR)
- No ATPCO fare filing support
- No private/negotiated fares

**Impact:** Cannot compete with any PSS that supports airline revenue optimization through fare classes and restrictions.

**Phase 5 Solution:** Complex Fare Rules Engine + RBD system

### 3.3 Codeshare & Interline (Critical Gap - Score: 0/10)

**Current State:** No support for airline partnerships.

**What's Missing:**

- No codeshare agreement management
- No interline ticketing
- No through-check baggage
- No prorate agreements
- No marketing/operating carrier distinction

**Impact:** Airlines using AIS cannot form partnerships or join alliances.

**Phase 5 Solution:** Codeshare/Interline Management System

### 3.4 EMD Support (Critical Gap - Score: 0/10)

**Current State:** Ancillary services exist but no EMD standard.

**What's Missing:**

- No EMD-S (Standalone) generation
- No EMD-A (Associated) for flight-related charges
- No service fee tracking via standard industry documents

**Impact:** Cannot process ancillary revenue through standard industry channels.

**Phase 5 Solution:** EMD Generation and Management

### 3.5 Seat Management (Moderate Gap - Score: 3/10)

**Current State:** Basic seat counts. No seat maps or visual selection.

**What's Missing:**

- No aircraft cabin configuration
- No seat map visualization
- No seat selection during booking
- No seat pricing tiers
- No check-in with seat assignment

**Impact:** Poor passenger experience and missed ancillary revenue opportunity.

**Phase 5 Solution:** Seat Map and Check-in System

---

## 4. Quantitative Assessment

### 4.1 Current Score Breakdown (32/100)

| Domain                 | Score | Weight   | Weighted |
| ---------------------- | ----- | -------- | -------- |
| Core PSS Functions     | 3/10  | 15%      | 4.5      |
| Distribution (GDS/NDC) | 1/10  | 15%      | 1.5      |
| Inventory Management   | 5/10  | 10%      | 5.0      |
| DCS/Departure          | 4/10  | 10%      | 4.0      |
| Technology/Modernity   | 8/10  | 10%      | 8.0      |
| Regulatory Compliance  | 3/10  | 10%      | 3.0      |
| Security               | 5/10  | 5%       | 2.5      |
| Scalability            | 2/10  | 5%       | 1.0      |
| User Experience        | 6/10  | 10%      | 6.0      |
| AI/Innovation          | 7/10  | 10%      | 7.0      |
| **Total**              |       | **100%** | **42.5** |

### 4.2 Post-Phase 5 Target Score (75/100)

| Domain                 | Current | Target | Delta |
| ---------------------- | ------- | ------ | ----- |
| Core PSS Functions     | 3/10    | 7/10   | +4    |
| Distribution (GDS/NDC) | 1/10    | 6/10   | +5    |
| Inventory Management   | 5/10    | 8/10   | +3    |
| DCS/Departure          | 4/10    | 7/10   | +3    |
| Technology/Modernity   | 8/10    | 9/10   | +1    |
| Regulatory Compliance  | 3/10    | 7/10   | +4    |
| Security               | 5/10    | 7/10   | +2    |
| Scalability            | 2/10    | 5/10   | +3    |
| User Experience        | 6/10    | 8/10   | +2    |
| AI/Innovation          | 7/10    | 8/10   | +1    |

---

## 5. Implementation Roadmap

### Phase 5: Industry Standards Gap Closure (Current)

**Duration:** 3-6 months | **Impact:** +28 points

| Feature                        | Priority | Complexity | Status         |
| ------------------------------ | -------- | ---------- | -------------- |
| NDC API Gateway                | Critical | High       | ✅ Implemented |
| GDS Integration Gateway        | Critical | High       | ✅ Implemented |
| Codeshare/Interline Management | Critical | High       | ✅ Implemented |
| EMD Support                    | Critical | Medium     | ✅ Implemented |
| Complex Fare Rules Engine      | Critical | High       | ✅ Implemented |
| Seat Map & Check-in System     | High     | Medium     | ✅ Implemented |

**New Database Tables:**

- `fareClasses` - RBD system with 16+ booking classes
- `fareRules` - Complex fare rules with restrictions
- `codeshareAgreements` - Airline codeshare partnerships
- `interlineAgreements` - Interline ticketing agreements
- `electronicMiscDocs` - EMD-S and EMD-A documents
- `ndcOffers` - NDC offer management
- `ndcOrders` - NDC order lifecycle
- `gdsConnections` - GDS provider configurations
- `gdsMessages` - GDS message audit log
- `seatMaps` - Aircraft cabin seat configurations
- `seatInventory` - Individual seat status and pricing

**New Services:**

- NDC Gateway Service (offers, orders, servicing)
- GDS Integration Service (multi-provider connectivity)
- Codeshare/Interline Service (agreements, proration)
- EMD Service (issuance, void, exchange)
- Fare Rules Engine (RBD, restrictions, validation)
- Seat Map Service (configuration, selection, check-in)

**New API Routers:**

- `ndc.*` - NDC API endpoints (11 procedures)
- `gds.*` - GDS management endpoints (9 procedures)
- `codeshare.*` - Codeshare management (8 procedures)
- `interline.*` - Interline management (7 procedures)
- `emd.*` - EMD operations (8 procedures)
- `fareRules.*` - Fare rules management (9 procedures)
- `seatMap.*` - Seat map and check-in (10 procedures)

### Phase 6: Production Readiness (6-12 months)

| Feature                   | Priority | Description                                   |
| ------------------------- | -------- | --------------------------------------------- |
| IATA Certification        | Critical | NDC Level 3+ certification                    |
| PCI DSS Compliance        | Critical | Payment card industry data security           |
| SOC 2 Type II             | High     | Security and availability audit               |
| Load Testing              | High     | 10K+ concurrent users, 1M+ daily transactions |
| Multi-tenant Architecture | High     | Support multiple airlines on single platform  |
| Disaster Recovery         | Medium   | RPO < 1 hour, RTO < 4 hours                   |

### Phase 7: Market Entry (12-24 months)

| Feature             | Priority | Description                    |
| ------------------- | -------- | ------------------------------ |
| ATPCO Integration   | High     | Standard fare filing           |
| ONE Order Migration | High     | IATA ONE Order standard        |
| Cargo Module        | Medium   | Basic cargo management         |
| Alliance Support    | Medium   | Star Alliance/oneworld/SkyTeam |
| Schedule Planning   | Medium   | Seasonal schedule management   |
| Fleet Assignment    | Low      | Aircraft type optimization     |

---

## 6. Competitive Positioning Strategy

### 6.1 Target Market

- Small to medium regional airlines (1-30 aircraft)
- MENA region carriers
- New entrant airlines (LCC/hybrid)
- Charter operators

### 6.2 Differentiation vs Crane PSS

| Factor     | AIS Advantage                        | Crane Advantage     |
| ---------- | ------------------------------------ | ------------------- |
| Technology | Modern stack (React/Node/TypeScript) | Mature, proven      |
| AI/ML      | Native AI pricing & chatbot          | Traditional RM      |
| Cloud      | Cloud-native architecture            | Hybrid              |
| Deployment | SaaS / self-hosted                   | Managed service     |
| Price      | Lower cost target                    | Established pricing |
| Arabic     | Native AR/EN bilingual               | Translation layer   |
| Ecosystem  | Open API, extensible                 | Closed ecosystem    |

### 6.3 Competitive Moat

1. **Modern Tech Stack** - Lower maintenance, faster iteration
2. **AI-First** - Native AI across pricing, chat, forecasting
3. **Open Architecture** - tRPC + REST + NDC + GDS integrations
4. **MENA Focus** - Native Arabic, SAR/regional payment gateways
5. **Cost Structure** - Cloud-native = lower TCO for small airlines

---

## 7. Risk Assessment

| Risk                       | Probability | Impact   | Mitigation                         |
| -------------------------- | ----------- | -------- | ---------------------------------- |
| IATA certification delays  | High        | Critical | Early engagement with IATA         |
| GDS integration complexity | High        | High     | Start with one GDS (Amadeus)       |
| Scale limitations          | Medium      | High     | Load testing + architecture review |
| Security vulnerabilities   | Medium      | Critical | PCI DSS + SOC 2 compliance         |
| Market competition         | High        | Medium   | Focus on MENA niche                |
| Talent availability        | Medium      | Medium   | Remote team, open source community |

---

## 8. Key Metrics & KPIs

### Technical KPIs

- API response time < 200ms (p95)
- System uptime > 99.9%
- Zero critical security vulnerabilities
- TypeScript: 0 errors, ESLint: 0 errors

### Business KPIs

- NDC certification by Q3 2026
- First airline POC by Q4 2026
- 3 airline customers by Q2 2027
- GDS connectivity live by Q1 2027

---

## 9. Architecture After Phase 5

```
┌─────────────────────────────────────────────────────────────┐
│                    Distribution Layer                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ NDC API   │  │ GDS      │  │ B2B API  │  │ Direct   │    │
│  │ Gateway   │  │ Gateway  │  │ Partners │  │ Web/App  │    │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘    │
│       └──────────────┴──────────────┴──────────────┘         │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────┴──────────────────────────────┐
│                     Core PSS Engine                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ Fare     │  │ Inventory│  │ Booking  │  │ Ticketing│    │
│  │ Engine   │  │ Control  │  │ Engine   │  │ & EMD    │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ Revenue  │  │ Codeshare│  │ Seat Map │  │ DCS      │    │
│  │ Mgmt/AI  │  │ Interline│  │ Check-in │  │ System   │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────┴──────────────────────────────┐
│                   Support Systems                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ Loyalty  │  │ Payments │  │ Notif.   │  │ Analytics│    │
│  │ Program  │  │ Gateway  │  │ Engine   │  │ & BI     │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## 10. Conclusion

Phase 5 closes the most critical gaps identified in the competitive analysis:

1. **Distribution** (NDC + GDS): From 1/10 → 6/10
2. **Fare Management** (Complex Fares + RBD): From 2/10 → 7/10
3. **Partnerships** (Codeshare + Interline): From 0/10 → 6/10
4. **Ancillary Revenue** (EMD): From 0/10 → 7/10
5. **Passenger Experience** (Seat Maps + Check-in): From 3/10 → 7/10

With these additions, AIS moves from a booking platform to a credible PSS competitor targeting small-to-medium regional airlines in the MENA region. The remaining phases (6-7) focus on certifications, production hardening, and market entry.

**Total New Components in Phase 5:**

- 11 new database tables
- 6 new service modules
- 7 new tRPC routers with 62+ endpoints
- 100+ new i18n keys (AR/EN)

---

_Document generated: February 2026_
_AIS Aviation System v5.0_
