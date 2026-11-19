# New vessel type

How to add a vessel type to delta-flume.

Result: `vessels/<name>.md`, and the vessel's row in the README's Vessels table.

1. Check that the responsibility is new. If a vessel in the [README](../README.md)'s Vessels table already covers it, change that vessel instead.
2. Copy [template.md](template.md) to `vessels/<name>.md`, where `<name>` is one lowercase word for the responsibility.
3. Fill it in from the top: Purpose, then Policy, then Mechanism. [vessels/maintenance.md](../vessels/maintenance.md) is a worked example.
4. In the Vessels table, link the vessel and set its status to `defined`.

To run the vessel in a project, follow [new-instance/](../new-instance/).
