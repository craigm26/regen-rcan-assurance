# regen-rcan-assurance

An independent verifier for RCAN Appendix C evidence (canonical JSON, envelope rules,
hash-chained gate decisions), rebuilt by agents from a spec.

**Status: spec in progress.** The durable asset is [`.regenerate/`](.regenerate/): the
specification, the decisions behind it, and a suite that judges any implementation from the
outside. `impl/` will hold implementations rebuilt blind from the spec.

Spec text and test fixtures derive from the RCAN specification
([rcan-spec](https://github.com/RobotRegistryFoundation/rcan-spec), CC BY 4.0). Code here is MIT.
