/**
 * Observatory Standards Library — seed catalog of frameworks and controls.
 *
 * Global (not tenant-scoped) catalog covering: WCAG 2.2, Section 508,
 * EN 301 549, VPAT, OWASP Top 10, OWASP ASVS, Microsoft Security Best
 * Practices, SOC 2, ISO 27001, GDPR, Responsible AI.
 *
 * Seeding is idempotent: frameworks are keyed by unique `code`; controls by
 * (frameworkId, controlId). Existing rows are left untouched.
 */
import { db } from "../db";
import { obsFrameworks, obsControls } from "@shared/schema";
import { eq } from "drizzle-orm";

interface ControlSeed {
  controlId: string;
  title: string;
  description?: string;
  category?: string;
  level?: string;
}

interface FrameworkSeed {
  code: string;
  name: string;
  version?: string;
  description: string;
  category: string;
  controls: ControlSeed[];
}

const WCAG22_CONTROLS: ControlSeed[] = [
  // Perceivable
  { controlId: "1.1.1", title: "Non-text Content", level: "A", category: "Perceivable", description: "All non-text content has a text alternative that serves the equivalent purpose." },
  { controlId: "1.2.1", title: "Audio-only and Video-only (Prerecorded)", level: "A", category: "Perceivable", description: "Alternatives are provided for prerecorded audio-only and video-only media." },
  { controlId: "1.2.2", title: "Captions (Prerecorded)", level: "A", category: "Perceivable", description: "Captions are provided for all prerecorded audio content in synchronized media." },
  { controlId: "1.2.3", title: "Audio Description or Media Alternative (Prerecorded)", level: "A", category: "Perceivable", description: "An alternative or audio description is provided for prerecorded video." },
  { controlId: "1.2.4", title: "Captions (Live)", level: "AA", category: "Perceivable", description: "Captions are provided for all live audio content in synchronized media." },
  { controlId: "1.2.5", title: "Audio Description (Prerecorded)", level: "AA", category: "Perceivable", description: "Audio description is provided for all prerecorded video content." },
  { controlId: "1.3.1", title: "Info and Relationships", level: "A", category: "Perceivable", description: "Information, structure, and relationships conveyed through presentation can be programmatically determined." },
  { controlId: "1.3.2", title: "Meaningful Sequence", level: "A", category: "Perceivable", description: "The correct reading sequence can be programmatically determined." },
  { controlId: "1.3.3", title: "Sensory Characteristics", level: "A", category: "Perceivable", description: "Instructions do not rely solely on sensory characteristics such as shape, size, or location." },
  { controlId: "1.3.4", title: "Orientation", level: "AA", category: "Perceivable", description: "Content does not restrict its view to a single display orientation." },
  { controlId: "1.3.5", title: "Identify Input Purpose", level: "AA", category: "Perceivable", description: "The purpose of common input fields can be programmatically determined." },
  { controlId: "1.4.1", title: "Use of Color", level: "A", category: "Perceivable", description: "Color is not the only visual means of conveying information." },
  { controlId: "1.4.2", title: "Audio Control", level: "A", category: "Perceivable", description: "Auto-playing audio can be paused, stopped, or its volume controlled." },
  { controlId: "1.4.3", title: "Contrast (Minimum)", level: "AA", category: "Perceivable", description: "Text has a contrast ratio of at least 4.5:1 (3:1 for large text)." },
  { controlId: "1.4.4", title: "Resize Text", level: "AA", category: "Perceivable", description: "Text can be resized up to 200% without loss of content or functionality." },
  { controlId: "1.4.5", title: "Images of Text", level: "AA", category: "Perceivable", description: "Text is used to convey information rather than images of text." },
  { controlId: "1.4.10", title: "Reflow", level: "AA", category: "Perceivable", description: "Content reflows without two-dimensional scrolling at 320 CSS pixels width." },
  { controlId: "1.4.11", title: "Non-text Contrast", level: "AA", category: "Perceivable", description: "UI components and graphical objects have a contrast ratio of at least 3:1." },
  { controlId: "1.4.12", title: "Text Spacing", level: "AA", category: "Perceivable", description: "No loss of content when text spacing is adjusted by the user." },
  { controlId: "1.4.13", title: "Content on Hover or Focus", level: "AA", category: "Perceivable", description: "Additional content triggered by hover or focus is dismissible, hoverable, and persistent." },
  // Operable
  { controlId: "2.1.1", title: "Keyboard", level: "A", category: "Operable", description: "All functionality is operable through a keyboard interface." },
  { controlId: "2.1.2", title: "No Keyboard Trap", level: "A", category: "Operable", description: "Keyboard focus can be moved away from any component using the keyboard." },
  { controlId: "2.1.4", title: "Character Key Shortcuts", level: "A", category: "Operable", description: "Single-character shortcuts can be turned off, remapped, or are only active on focus." },
  { controlId: "2.2.1", title: "Timing Adjustable", level: "A", category: "Operable", description: "Time limits can be turned off, adjusted, or extended." },
  { controlId: "2.2.2", title: "Pause, Stop, Hide", level: "A", category: "Operable", description: "Moving, blinking, or auto-updating content can be paused, stopped, or hidden." },
  { controlId: "2.3.1", title: "Three Flashes or Below Threshold", level: "A", category: "Operable", description: "Content does not flash more than three times per second." },
  { controlId: "2.4.1", title: "Bypass Blocks", level: "A", category: "Operable", description: "A mechanism is available to bypass repeated blocks of content." },
  { controlId: "2.4.2", title: "Page Titled", level: "A", category: "Operable", description: "Web pages have titles that describe topic or purpose." },
  { controlId: "2.4.3", title: "Focus Order", level: "A", category: "Operable", description: "Focusable components receive focus in an order that preserves meaning and operability." },
  { controlId: "2.4.4", title: "Link Purpose (In Context)", level: "A", category: "Operable", description: "The purpose of each link can be determined from the link text or context." },
  { controlId: "2.4.5", title: "Multiple Ways", level: "AA", category: "Operable", description: "More than one way is available to locate a page within a set of pages." },
  { controlId: "2.4.6", title: "Headings and Labels", level: "AA", category: "Operable", description: "Headings and labels describe topic or purpose." },
  { controlId: "2.4.7", title: "Focus Visible", level: "AA", category: "Operable", description: "Keyboard focus indicator is visible." },
  { controlId: "2.4.11", title: "Focus Not Obscured (Minimum)", level: "AA", category: "Operable", description: "When a component receives focus, it is not entirely hidden by author-created content. (New in 2.2)" },
  { controlId: "2.5.1", title: "Pointer Gestures", level: "A", category: "Operable", description: "Multipoint or path-based gestures have a single-pointer alternative." },
  { controlId: "2.5.2", title: "Pointer Cancellation", level: "A", category: "Operable", description: "Functions triggered by a single pointer can be cancelled." },
  { controlId: "2.5.3", title: "Label in Name", level: "A", category: "Operable", description: "The accessible name contains the visible label text." },
  { controlId: "2.5.4", title: "Motion Actuation", level: "A", category: "Operable", description: "Functionality triggered by device motion can also be operated by UI components." },
  { controlId: "2.5.7", title: "Dragging Movements", level: "AA", category: "Operable", description: "Dragging actions have a single-pointer alternative. (New in 2.2)" },
  { controlId: "2.5.8", title: "Target Size (Minimum)", level: "AA", category: "Operable", description: "Pointer targets are at least 24×24 CSS pixels, with exceptions. (New in 2.2)" },
  // Understandable
  { controlId: "3.1.1", title: "Language of Page", level: "A", category: "Understandable", description: "The default human language of the page can be programmatically determined." },
  { controlId: "3.1.2", title: "Language of Parts", level: "AA", category: "Understandable", description: "The language of passages can be programmatically determined." },
  { controlId: "3.2.1", title: "On Focus", level: "A", category: "Understandable", description: "Receiving focus does not initiate a change of context." },
  { controlId: "3.2.2", title: "On Input", level: "A", category: "Understandable", description: "Changing a setting does not automatically cause a change of context." },
  { controlId: "3.2.3", title: "Consistent Navigation", level: "AA", category: "Understandable", description: "Navigation mechanisms are repeated in the same relative order." },
  { controlId: "3.2.4", title: "Consistent Identification", level: "AA", category: "Understandable", description: "Components with the same functionality are identified consistently." },
  { controlId: "3.2.6", title: "Consistent Help", level: "A", category: "Understandable", description: "Help mechanisms occur in the same order across pages. (New in 2.2)" },
  { controlId: "3.3.1", title: "Error Identification", level: "A", category: "Understandable", description: "Input errors are identified and described to the user in text." },
  { controlId: "3.3.2", title: "Labels or Instructions", level: "A", category: "Understandable", description: "Labels or instructions are provided when content requires user input." },
  { controlId: "3.3.3", title: "Error Suggestion", level: "AA", category: "Understandable", description: "Suggestions for correcting input errors are provided when known." },
  { controlId: "3.3.4", title: "Error Prevention (Legal, Financial, Data)", level: "AA", category: "Understandable", description: "Submissions are reversible, checked, or confirmed for consequential transactions." },
  { controlId: "3.3.7", title: "Redundant Entry", level: "A", category: "Understandable", description: "Previously entered information is auto-populated or available for selection. (New in 2.2)" },
  { controlId: "3.3.8", title: "Accessible Authentication (Minimum)", level: "AA", category: "Understandable", description: "Authentication does not rely on a cognitive function test without alternatives. (New in 2.2)" },
  // Robust
  { controlId: "4.1.2", title: "Name, Role, Value", level: "A", category: "Robust", description: "Name, role, and value of UI components can be programmatically determined and set." },
  { controlId: "4.1.3", title: "Status Messages", level: "AA", category: "Robust", description: "Status messages can be programmatically determined without receiving focus." },
];

export const STANDARDS_CATALOG: FrameworkSeed[] = [
  {
    code: "WCAG22",
    name: "WCAG 2.2",
    version: "2.2",
    category: "accessibility",
    description: "Web Content Accessibility Guidelines 2.2 — Level A and AA success criteria for perceivable, operable, understandable, and robust web content.",
    controls: WCAG22_CONTROLS,
  },
  {
    code: "SECTION_508",
    name: "Section 508",
    version: "2017 Refresh",
    category: "accessibility",
    description: "U.S. federal ICT accessibility requirements (36 CFR Part 1194), harmonized with WCAG 2.0 AA.",
    controls: [
      { controlId: "E205", title: "Electronic Content", category: "Scoping", description: "Public-facing and certain agency official communications content conforms to WCAG 2.0 Level A and AA." },
      { controlId: "501.1", title: "Software Scope", category: "Software", description: "Software that is assistive technology, platform software, or applications conforms to Chapter 5." },
      { controlId: "502.2", title: "Documented Accessibility Features", category: "Software", description: "Platform features defined in platform documentation as accessibility features are documented and preserved." },
      { controlId: "502.3", title: "Accessibility Services", category: "Software", description: "Platform and software tools provide a documented set of accessibility services (programmatic access to object information, states, properties, actions, and events)." },
      { controlId: "503.2", title: "User Preferences", category: "Software", description: "Applications permit user preferences from platform settings for color, contrast, font type, font size, and focus cursor." },
      { controlId: "503.4", title: "User Controls for Captions and Audio Description", category: "Software", description: "Media players expose user controls for closed captions and audio descriptions." },
      { controlId: "504.2", title: "Authoring Tool Content Creation", category: "Authoring Tools", description: "Authoring tools allow creation of content conforming to WCAG 2.0 A/AA." },
      { controlId: "602.3", title: "Electronic Support Documentation", category: "Documentation", description: "Electronic support documentation conforms to WCAG 2.0 Level A and AA." },
      { controlId: "FPC-302.1", title: "Without Vision", category: "Functional Performance", description: "At least one mode of operation is provided that does not require user vision." },
      { controlId: "FPC-302.2", title: "With Limited Vision", category: "Functional Performance", description: "At least one mode of operation enables users with limited vision." },
      { controlId: "FPC-302.4", title: "Without Perception of Color", category: "Functional Performance", description: "At least one visual mode of operation does not require user perception of color." },
      { controlId: "FPC-302.7", title: "With Limited Manipulation", category: "Functional Performance", description: "At least one mode of operation does not require fine motor control or simultaneous manual operations." },
      { controlId: "FPC-302.8", title: "With Limited Reach and Strength", category: "Functional Performance", description: "At least one mode of operation is operable with limited reach and limited strength." },
      { controlId: "FPC-302.9", title: "With Limited Language, Cognitive, and Learning Abilities", category: "Functional Performance", description: "Features make use simpler and easier for users with limited cognitive abilities." },
    ],
  },
  {
    code: "EN301549",
    name: "EN 301 549",
    version: "3.2.1",
    category: "accessibility",
    description: "European accessibility requirements for ICT products and services — the standard underpinning the European Accessibility Act.",
    controls: [
      { controlId: "5.2", title: "Activation of accessibility features", category: "Generic Requirements", description: "Documented accessibility features can be activated without relying on a method that does not support accessibility." },
      { controlId: "6.1", title: "Audio bandwidth for speech", category: "Two-way Voice", description: "ICT providing two-way voice communication encodes speech with adequate frequency bandwidth." },
      { controlId: "7.1.1", title: "Captioning playback", category: "Video Capabilities", description: "ICT that displays video with synchronized audio provides a mode to display available captions." },
      { controlId: "7.2.1", title: "Audio description playback", category: "Video Capabilities", description: "A mechanism is provided to select and play available audio description." },
      { controlId: "9", title: "Web content conformance (WCAG 2.1 AA)", category: "Web", description: "Web pages satisfy WCAG 2.1 Level A and AA success criteria." },
      { controlId: "10", title: "Non-web documents", category: "Documents", description: "Non-web documents satisfy the WCAG-derived criteria of clause 10." },
      { controlId: "11", title: "Software (incl. mobile apps)", category: "Software", description: "Non-web software including mobile applications satisfies the WCAG-derived criteria of clause 11." },
      { controlId: "11.8.1", title: "Authoring tool content technology", category: "Software", description: "Authoring tools conform to accessible content production requirements." },
      { controlId: "12.1.1", title: "Accessibility and compatibility features documentation", category: "Documentation & Support", description: "Product documentation lists and explains accessibility and compatibility features." },
      { controlId: "12.2.2", title: "Information on accessibility and compatibility features (support)", category: "Documentation & Support", description: "Support services provide information on accessibility and compatibility features." },
    ],
  },
  {
    code: "VPAT",
    name: "VPAT / ACR",
    version: "2.5",
    category: "accessibility",
    description: "Voluntary Product Accessibility Template — the reporting format for Accessibility Conformance Reports covering WCAG, Section 508, and EN 301 549 editions.",
    controls: [
      { controlId: "VPAT-WCAG", title: "WCAG Edition Tables", category: "Reporting", description: "Report conformance level (Supports / Partially Supports / Does Not Support / Not Applicable) for each WCAG success criterion." },
      { controlId: "VPAT-508", title: "Section 508 Edition Tables", category: "Reporting", description: "Report conformance against Revised Section 508 chapters 3–6." },
      { controlId: "VPAT-EU", title: "EN 301 549 Edition Tables", category: "Reporting", description: "Report conformance against EN 301 549 clauses 4–13." },
      { controlId: "VPAT-NOTES", title: "Remarks and Explanations", category: "Reporting", description: "Each criterion's conformance claim includes remarks that explain limitations and known defects." },
      { controlId: "VPAT-EVAL", title: "Evaluation Methods", category: "Reporting", description: "The ACR documents the testing methodology (automated tools, manual testing, assistive technology matrix)." },
    ],
  },
  {
    code: "OWASP_TOP10",
    name: "OWASP Top 10",
    version: "2021",
    category: "security",
    description: "The ten most critical web application security risks.",
    controls: [
      { controlId: "A01:2021", title: "Broken Access Control", category: "Risk", description: "Restrictions on authenticated users are not properly enforced — IDOR, privilege escalation, forced browsing." },
      { controlId: "A02:2021", title: "Cryptographic Failures", category: "Risk", description: "Failures related to cryptography that expose sensitive data (weak algorithms, missing encryption in transit/at rest)." },
      { controlId: "A03:2021", title: "Injection", category: "Risk", description: "SQL, NoSQL, OS command, and LDAP injection, including cross-site scripting." },
      { controlId: "A04:2021", title: "Insecure Design", category: "Risk", description: "Missing or ineffective control design — threat modeling and secure design patterns absent." },
      { controlId: "A05:2021", title: "Security Misconfiguration", category: "Risk", description: "Insecure default configurations, verbose errors, unnecessary features, missing hardening." },
      { controlId: "A06:2021", title: "Vulnerable and Outdated Components", category: "Risk", description: "Use of components with known vulnerabilities or unsupported versions." },
      { controlId: "A07:2021", title: "Identification and Authentication Failures", category: "Risk", description: "Weak authentication, credential stuffing exposure, session management flaws." },
      { controlId: "A08:2021", title: "Software and Data Integrity Failures", category: "Risk", description: "Code and infrastructure that do not protect against integrity violations (insecure CI/CD, unsigned updates, insecure deserialization)." },
      { controlId: "A09:2021", title: "Security Logging and Monitoring Failures", category: "Risk", description: "Insufficient logging, detection, monitoring, and active response." },
      { controlId: "A10:2021", title: "Server-Side Request Forgery (SSRF)", category: "Risk", description: "Fetching remote resources without validating the user-supplied URL." },
    ],
  },
  {
    code: "OWASP_ASVS",
    name: "OWASP ASVS",
    version: "4.0.3",
    category: "security",
    description: "Application Security Verification Standard — requirements for designing, developing, and testing secure applications.",
    controls: [
      { controlId: "V1", title: "Architecture, Design and Threat Modeling", category: "Chapter", description: "Secure SDLC, threat modeling, and security architecture verification requirements." },
      { controlId: "V2", title: "Authentication", category: "Chapter", description: "Password security, credential storage, MFA, and authenticator lifecycle requirements." },
      { controlId: "V3", title: "Session Management", category: "Chapter", description: "Session binding, timeout, termination, and cookie-based session requirements." },
      { controlId: "V4", title: "Access Control", category: "Chapter", description: "General access control design, operation-level, and data-level authorization requirements." },
      { controlId: "V5", title: "Validation, Sanitization and Encoding", category: "Chapter", description: "Input validation, sanitization, output encoding, and injection-prevention requirements." },
      { controlId: "V6", title: "Stored Cryptography", category: "Chapter", description: "Data classification, algorithms, random values, and secret management requirements." },
      { controlId: "V7", title: "Error Handling and Logging", category: "Chapter", description: "Log content, processing, protection, and error handling requirements." },
      { controlId: "V8", title: "Data Protection", category: "Chapter", description: "General data protection, client-side data protection, and sensitive private data requirements." },
      { controlId: "V9", title: "Communication", category: "Chapter", description: "TLS configuration and server communication security requirements." },
      { controlId: "V10", title: "Malicious Code", category: "Chapter", description: "Code integrity, malicious code search, and application integrity requirements." },
      { controlId: "V11", title: "Business Logic", category: "Chapter", description: "Business logic security requirements — sequencing, limits, anti-automation." },
      { controlId: "V12", title: "Files and Resources", category: "Chapter", description: "File upload, integrity, execution, storage, and download requirements." },
      { controlId: "V13", title: "API and Web Service", category: "Chapter", description: "Generic web service, RESTful, SOAP, and GraphQL security requirements." },
      { controlId: "V14", title: "Configuration", category: "Chapter", description: "Build, dependency, unintended information leakage, and HTTP security header requirements." },
    ],
  },
  {
    code: "MS_SEC",
    name: "Microsoft Security Best Practices",
    version: "2024",
    category: "security",
    description: "Microsoft cloud and application security best practices, including identity, Zero Trust, and Azure workload guidance.",
    controls: [
      { controlId: "MS-ID-1", title: "Enforce Multi-Factor Authentication", category: "Identity", description: "Require MFA for all users, prioritizing administrators, via Conditional Access or security defaults." },
      { controlId: "MS-ID-2", title: "Use Managed Identities", category: "Identity", description: "Replace credentials and secrets in code with managed identities for Azure resource access." },
      { controlId: "MS-ID-3", title: "Apply Least-Privilege Access", category: "Identity", description: "Use role-based access control with just-enough and just-in-time access (PIM)." },
      { controlId: "MS-ZT-1", title: "Verify Explicitly (Zero Trust)", category: "Zero Trust", description: "Always authenticate and authorize based on all available data points — identity, location, device health." },
      { controlId: "MS-ZT-2", title: "Assume Breach", category: "Zero Trust", description: "Segment access, verify end-to-end encryption, and use analytics to detect threats." },
      { controlId: "MS-DATA-1", title: "Encrypt Data at Rest and in Transit", category: "Data Protection", description: "Use platform encryption for storage and TLS 1.2+ for all communication." },
      { controlId: "MS-DATA-2", title: "Protect Secrets in Key Vault", category: "Data Protection", description: "Store keys, secrets, and certificates in Azure Key Vault (or equivalent) with access policies and rotation." },
      { controlId: "MS-NET-1", title: "Secure Network Perimeters", category: "Network", description: "Use private endpoints, network security groups, and WAF for exposed workloads." },
      { controlId: "MS-OPS-1", title: "Enable Security Monitoring", category: "Operations", description: "Enable Defender for Cloud / Sentinel telemetry, alerts, and vulnerability assessment." },
      { controlId: "MS-OPS-2", title: "Patch and Update Continuously", category: "Operations", description: "Keep OS, runtimes, and dependencies current; automate update management." },
      { controlId: "MS-DEV-1", title: "Secure DevOps Pipeline", category: "Development", description: "Protect CI/CD with branch policies, secret scanning, dependency scanning, and signed artifacts." },
    ],
  },
  {
    code: "SOC2",
    name: "SOC 2",
    version: "2017 TSC (2022 revised)",
    category: "compliance",
    description: "AICPA Trust Services Criteria for security, availability, processing integrity, confidentiality, and privacy.",
    controls: [
      { controlId: "CC1", title: "Control Environment", category: "Common Criteria", description: "Integrity, ethical values, board oversight, organizational structure, and accountability." },
      { controlId: "CC2", title: "Communication and Information", category: "Common Criteria", description: "Quality information is generated and communicated internally and externally to support controls." },
      { controlId: "CC3", title: "Risk Assessment", category: "Common Criteria", description: "Objectives are specified, risks identified and analyzed, and fraud risk considered." },
      { controlId: "CC4", title: "Monitoring Activities", category: "Common Criteria", description: "Ongoing and separate evaluations of controls; deficiencies communicated and remediated." },
      { controlId: "CC5", title: "Control Activities", category: "Common Criteria", description: "Control activities, including over technology, are selected, developed, and deployed through policies." },
      { controlId: "CC6", title: "Logical and Physical Access Controls", category: "Common Criteria", description: "Access to systems and data is restricted, credentials managed, and physical access protected." },
      { controlId: "CC7", title: "System Operations", category: "Common Criteria", description: "Vulnerability detection, security incident monitoring, response, and recovery." },
      { controlId: "CC8", title: "Change Management", category: "Common Criteria", description: "Infrastructure, data, and software changes are authorized, designed, tested, and approved." },
      { controlId: "CC9", title: "Risk Mitigation", category: "Common Criteria", description: "Risk mitigation activities including business disruption and vendor management." },
      { controlId: "A1", title: "Availability", category: "Availability", description: "Capacity management, environmental protections, backup, and recovery to meet objectives." },
      { controlId: "C1", title: "Confidentiality", category: "Confidentiality", description: "Confidential information is identified, protected, and disposed of to meet objectives." },
      { controlId: "PI1", title: "Processing Integrity", category: "Processing Integrity", description: "System processing is complete, valid, accurate, timely, and authorized." },
      { controlId: "P1-P8", title: "Privacy Criteria", category: "Privacy", description: "Notice, choice and consent, collection, use/retention/disposal, access, disclosure, quality, and monitoring." },
    ],
  },
  {
    code: "ISO27001",
    name: "ISO/IEC 27001",
    version: "2022",
    category: "compliance",
    description: "International standard for information security management systems (ISMS), Annex A control themes.",
    controls: [
      { controlId: "A.5.1", title: "Policies for information security", category: "Organizational", description: "Information security policy and topic-specific policies defined, approved, and reviewed." },
      { controlId: "A.5.9", title: "Inventory of information and other associated assets", category: "Organizational", description: "An inventory of information and associated assets, including owners, is maintained." },
      { controlId: "A.5.15", title: "Access control", category: "Organizational", description: "Rules to control physical and logical access to information are established." },
      { controlId: "A.5.23", title: "Information security for use of cloud services", category: "Organizational", description: "Processes for acquisition, use, management, and exit from cloud services are established." },
      { controlId: "A.5.24", title: "Incident management planning and preparation", category: "Organizational", description: "Incident management processes, roles, and responsibilities are planned and communicated." },
      { controlId: "A.6.3", title: "Information security awareness, education and training", category: "People", description: "Personnel receive appropriate awareness education and training." },
      { controlId: "A.6.5", title: "Responsibilities after termination or change of employment", category: "People", description: "Security responsibilities that remain valid after termination are defined and enforced." },
      { controlId: "A.7.1", title: "Physical security perimeters", category: "Physical", description: "Security perimeters protect areas containing information and other associated assets." },
      { controlId: "A.7.10", title: "Storage media", category: "Physical", description: "Storage media are managed through their lifecycle of acquisition, use, transportation, and disposal." },
      { controlId: "A.8.2", title: "Privileged access rights", category: "Technological", description: "Allocation and use of privileged access rights are restricted and managed." },
      { controlId: "A.8.8", title: "Management of technical vulnerabilities", category: "Technological", description: "Vulnerabilities are identified, exposure evaluated, and appropriate measures taken." },
      { controlId: "A.8.12", title: "Data leakage prevention", category: "Technological", description: "Data leakage prevention measures are applied to systems, networks, and devices." },
      { controlId: "A.8.16", title: "Monitoring activities", category: "Technological", description: "Networks, systems, and applications are monitored for anomalous behaviour." },
      { controlId: "A.8.24", title: "Use of cryptography", category: "Technological", description: "Rules for effective use of cryptography, including key management, are defined." },
      { controlId: "A.8.25", title: "Secure development life cycle", category: "Technological", description: "Rules for the secure development of software and systems are established and applied." },
      { controlId: "A.8.28", title: "Secure coding", category: "Technological", description: "Secure coding principles are applied to software development." },
    ],
  },
  {
    code: "GDPR",
    name: "GDPR",
    version: "2016/679",
    category: "privacy",
    description: "EU General Data Protection Regulation — key articles for application-level privacy compliance.",
    controls: [
      { controlId: "Art.5", title: "Principles relating to processing", category: "Principles", description: "Lawfulness, fairness, transparency, purpose limitation, data minimisation, accuracy, storage limitation, integrity, and accountability." },
      { controlId: "Art.6", title: "Lawfulness of processing", category: "Principles", description: "Processing has a valid legal basis (consent, contract, legal obligation, vital interests, public task, legitimate interests)." },
      { controlId: "Art.7", title: "Conditions for consent", category: "Principles", description: "Consent is freely given, specific, informed, unambiguous, and withdrawable." },
      { controlId: "Art.12-14", title: "Transparent information", category: "Data Subject Rights", description: "Privacy notices are concise, transparent, intelligible, and provided at collection." },
      { controlId: "Art.15", title: "Right of access", category: "Data Subject Rights", description: "Data subjects can obtain confirmation of processing and a copy of their personal data." },
      { controlId: "Art.16-17", title: "Rectification and erasure", category: "Data Subject Rights", description: "Data subjects can obtain rectification of inaccurate data and erasure ('right to be forgotten')." },
      { controlId: "Art.20", title: "Data portability", category: "Data Subject Rights", description: "Data subjects can receive their data in a structured, commonly used, machine-readable format." },
      { controlId: "Art.25", title: "Data protection by design and by default", category: "Controller Obligations", description: "Technical and organisational measures implement data-protection principles by design and default." },
      { controlId: "Art.30", title: "Records of processing activities", category: "Controller Obligations", description: "A record of processing activities under the controller's responsibility is maintained." },
      { controlId: "Art.32", title: "Security of processing", category: "Controller Obligations", description: "Appropriate technical and organisational measures ensure a level of security appropriate to the risk." },
      { controlId: "Art.33-34", title: "Breach notification", category: "Controller Obligations", description: "Personal data breaches are notified to the supervisory authority within 72 hours and to data subjects when high risk." },
      { controlId: "Art.35", title: "Data protection impact assessment", category: "Controller Obligations", description: "DPIAs are conducted for processing likely to result in high risk to individuals." },
      { controlId: "Art.44-49", title: "International transfers", category: "Transfers", description: "Transfers outside the EEA rely on adequacy, appropriate safeguards, or derogations." },
    ],
  },
  {
    code: "RESP_AI",
    name: "Responsible AI",
    version: "1.0",
    category: "ai",
    description: "Responsible AI principles and controls (aligned with Microsoft Responsible AI Standard and NIST AI RMF).",
    controls: [
      { controlId: "RAI-1", title: "Fairness", category: "Principle", description: "AI systems treat all people fairly — assess and mitigate demographic performance disparities and allocation harms." },
      { controlId: "RAI-2", title: "Reliability and Safety", category: "Principle", description: "AI systems perform reliably and safely — define operating conditions, failure modes, and fallback behavior." },
      { controlId: "RAI-3", title: "Privacy and Security", category: "Principle", description: "AI systems are secure and respect privacy — training data governance, prompt/response data handling, and access control." },
      { controlId: "RAI-4", title: "Inclusiveness", category: "Principle", description: "AI systems empower everyone — accessibility of AI-driven experiences and inclusive design review." },
      { controlId: "RAI-5", title: "Transparency", category: "Principle", description: "AI systems are understandable — disclose AI use, explain outputs, and document model capabilities and limitations." },
      { controlId: "RAI-6", title: "Accountability", category: "Principle", description: "People are accountable for AI systems — human oversight, impact assessments, and clear escalation ownership." },
      { controlId: "RAI-7", title: "Human Oversight & Control", category: "Operational", description: "Human-in-the-loop or human-on-the-loop controls exist for consequential decisions; users can contest outcomes." },
      { controlId: "RAI-8", title: "Data and Model Governance", category: "Operational", description: "Training/grounding data provenance, model versioning, and evaluation records are documented and auditable." },
      { controlId: "RAI-9", title: "Content Safety", category: "Operational", description: "Generated content is filtered for harmful output; jailbreak and prompt-injection defenses are tested." },
      { controlId: "RAI-10", title: "Monitoring and Incident Response", category: "Operational", description: "Deployed AI behavior is monitored for drift, misuse, and harm; AI incidents have a response path." },
    ],
  },
];

/**
 * Idempotent seed: insert any missing frameworks and controls.
 * Returns counts of inserted rows.
 */
export async function seedStandardsCatalog(): Promise<{ frameworks: number; controls: number }> {
  let frameworksInserted = 0;
  let controlsInserted = 0;

  for (let i = 0; i < STANDARDS_CATALOG.length; i++) {
    const fw = STANDARDS_CATALOG[i];
    let [row] = await db.select().from(obsFrameworks).where(eq(obsFrameworks.code, fw.code));
    if (!row) {
      [row] = await db
        .insert(obsFrameworks)
        .values({
          code: fw.code,
          name: fw.name,
          version: fw.version,
          description: fw.description,
          category: fw.category,
          sortOrder: i,
        })
        .onConflictDoNothing()
        .returning();
      if (!row) {
        [row] = await db.select().from(obsFrameworks).where(eq(obsFrameworks.code, fw.code));
      } else {
        frameworksInserted++;
      }
    }
    if (!row) continue;

    const values = fw.controls.map((c, idx) => ({
      frameworkId: row.id,
      controlId: c.controlId,
      title: c.title,
      description: c.description,
      category: c.category,
      level: c.level,
      sortOrder: idx,
    }));
    if (values.length > 0) {
      const inserted = await db
        .insert(obsControls)
        .values(values)
        .onConflictDoNothing()
        .returning({ id: obsControls.id });
      controlsInserted += inserted.length;
    }
  }

  return { frameworks: frameworksInserted, controls: controlsInserted };
}
