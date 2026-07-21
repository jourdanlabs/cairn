---
title: Change Management Policy
authority: controlled
owner: Head of IT Operations
version: 1.8
effective: 2025-01-30
review_cycle: annual
tags: [change, operations, controlled]
---

# Change Management Policy

## Purpose

This policy ensures that changes to production systems are authorized, tested,
and traceable, so that changes do not compromise the security or availability of
client-facing services.

## Change Categories

Changes are classified as standard (pre-approved, low risk), normal (requires
Change Advisory Board review), or emergency (expedited, with retrospective
review). Every change carries a documented rollback plan.

## Authorization and Segregation of Duties

No individual may author, approve, and deploy the same change to a production
system holding client data. Access to deploy changes is governed by the
[[Access Control Policy]].

## Testing and Records

Normal and emergency changes require evidence of testing and a completed change
record. Change records are retained in line with the [[Data Retention Policy]].

## Failed Changes

A failed change that degrades a client-facing service is raised as an incident
under the [[Incident Response Policy]].
