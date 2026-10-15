# Roadmap

This file tracks **known gaps between the UI and what is actually wired
up**, so contributors can find work that is clearly scoped. The live backlog
and in-flight work are in
[GitHub Issues](https://github.com/whiparc/whiparc/issues) and
[Discussions](https://github.com/whiparc/whiparc/discussions).

## Known placeholders

These pieces render something that is not backed by real data or behavior
yet. Each is a good, self-contained first contribution.

| Where | What is not real | Suggested direction |
| :--- | :--- | :--- |
| Dashboard overview, "Cloud spend this month" tile (`apps/web/app/dashboard/DashboardV2.tsx`) | No cost data is computed. The tile says "Cost estimates coming soon" (locked behind an Upgrade button for Free users on a plan-enforcing deployment) | Estimate cost from the compiled Terraform at deploy time and sum it per month, see [#148](https://github.com/whiparc/whiparc/issues/148) |
| Security audit (`apps/web/app/components/RightPanel.tsx`) | The only mention is a "Security audit coming soon" label in a legacy component that no longer renders, so the live inspector has no audit | Implement basic checks over the canvas graph in the live inspector, see [#147](https://github.com/whiparc/whiparc/issues/147) |
| GCP Target | Not tested end to end; dropping one on the canvas shows a "coming soon" notice | Validate compile and deploy against a real GCP project, then remove the notice, see [#149](https://github.com/whiparc/whiparc/issues/149) |

If you fix one, remove its row in the same pull request.

## How to propose something new

Open a [feature request](.github/ISSUE_TEMPLATE/feature_request.yml) or start
a [Discussion](https://github.com/whiparc/whiparc/discussions) rather than
editing this file directly. Issues are easier to discuss and track than a
Markdown list.
