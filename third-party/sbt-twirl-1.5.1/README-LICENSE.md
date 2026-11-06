# sbt-twirl 1.5.1 license evidence

Component: `com.typesafe.sbt:sbt-twirl:1.5.1` (Scala 2.12 / sbt 1.0 plugin).
License: **Apache-2.0**.
Copyright attribution in the pinned source: `Copyright (C) Lightbend Inc. <https://www.lightbend.com>`.

Twirl is Play's template engine. `sbt-twirl` is its sbt integration plugin; it is not the same artifact as `twirl-api`.

## First-party source

- Repository/tag: https://github.com/playframework/twirl/tree/1.5.1
- Resolved commit: `d176bc29ac5af7ba2b57d45b0424a218136b6fff`.
- License: https://github.com/playframework/twirl/blob/d176bc29ac5af7ba2b57d45b0424a218136b6fff/LICENSE
- Plugin declaration: https://github.com/playframework/twirl/blob/d176bc29ac5af7ba2b57d45b0424a218136b6fff/build.sbt

The pinned `build.sbt` defines the `sbt-twirl` project with organization `com.typesafe.sbt`, enables `PlaySbtPlugin` and `SbtPlugin`, and includes it in the Twirl root aggregate. The pinned README identifies Twirl as the Play template engine and documents the same plugin coordinates. The complete Git tree contains the root LICENSE and no separate LICENSE/NOTICE/COPYING file for the plugin.

## Captured material

`EVIDENCE.json` lists public HTTPS URLs, byte counts, SHA-256 values, command exits and the exact local Ivy/JAR fingerprints. `tag.json` binds the tag to the commit; `tree.json` is the untruncated Git tree. LICENSE, upstream README, build definition and plugin source bytes were compared with their Git blob identities.

Files named `README.md`, `build.sbt`, `LICENSE`, and `sbt-twirl__src__main__scala__play__twirl__sbt__SbtTwirl.scala` are unmodified upstream evidence, not executable project configuration. Empty `.stderr` files preserve successful fetch diagnostics. Do not run a build from this evidence directory.

This resolves the plugin-specific missing-license-evidence finding. It does not prove reproducible binary provenance, constitute legal approval, or certify the entire release. No build dependency was downloaded or changed. Historical supply inventories and old failure receipts remain unchanged.

## Redistribution

A release redistributing this component must include the Apache-2.0 license and retain applicable attribution notices. Mark modifications if upstream files are changed; retain applicable NOTICE text if present in distributed material. No separate NOTICE was found in this pinned source tree. The complete LICENSE is authoritative; this paragraph is only a packaging reminder.

The evidence is installed here for the future release writer. `dist/v1` has not been produced, and automatic consumption by the formal release gate remains to be implemented.
