---
title: Cryptographic Key Management Standard
authority: controlled
owner: Chief Information Security Officer
version: 1.0
effective: 2025-06-01
review_cycle: annual
tags: [encryption, keys, security, controlled]
---

# Cryptographic Key Management Standard

## Purpose

This standard defines how cryptographic keys are generated, distributed, stored,
rotated, and retired across the firm, so that the encryption required by the
[[Data Classification Policy]] is backed by keys that are themselves controlled.

## Key Lifecycle

Keys are generated in an approved hardware security module, distributed only to
authorized services, rotated on a defined schedule, and retired and destroyed when
no longer required. Key material is never stored alongside the data it protects.

## Access and Segregation

Access to key-management functions follows least privilege under the
[[Access Control Policy]], with dual control for key generation and destruction.
No single individual can both create and export a production key.

## Incident Handling

Suspected key compromise is treated as a security incident and handled under the
[[Incident Response Policy]], including immediate rotation of affected keys.
