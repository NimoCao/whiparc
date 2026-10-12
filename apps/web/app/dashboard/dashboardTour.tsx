import type { TourStep } from '../components/ProductTour';

// Steps for the first-run dashboard tour. Each `target` matches a
// `data-tour` attribute in DashboardV2.tsx; the tour drops any step whose
// target is not on screen (the checklist, for instance, is only rendered for
// users who have not dismissed it), so adding or removing UI there never
// leaves the tour pointing at nothing.
//
// Copy only describes what the page really does today: the "Cloud spend"
// tile is not mentioned because it is still placeholder data.
export function getDashboardTourSteps(firstName: string): TourStep[] {
  return [
    {
      id: 'welcome',
      icon: 'lucide:compass',
      title: firstName ? `Welcome to Whiparc, ${firstName}` : 'Welcome to Whiparc',
      body: (
        <>
          <p>Draw your infrastructure on a canvas, get Terraform, Ansible and Kubernetes code out of it, and run it in a local sandbox.</p>
          <p>This short tour shows what each part of the dashboard does.</p>
        </>
      ),
    },
    {
      id: 'nav',
      target: 'nav',
      icon: 'lucide:layout-dashboard',
      title: 'Find your way around',
      placement: 'right',
      body: (
        <p>
          Projects lists every workspace you can open and Templates has ready-made stacks to start from. Runs is the history of every plan and deploy, Credentials holds your
          encrypted cloud keys, and Team manages members. Docs has the setup guides.
        </p>
      ),
    },
    {
      id: 'team',
      target: 'team',
      icon: 'lucide:users',
      title: 'Switch teams',
      placement: 'bottom',
      body: <p>Projects and billing belong to a team. Use this switcher to move between teams or create a new one; the projects below follow your selection.</p>,
    },
    {
      id: 'search',
      target: 'search',
      icon: 'lucide:search',
      title: 'Search and jump',
      placement: 'bottom',
      body: (
        <p>
          Filter your projects by name here. Press <code>⌘K</code> or <code>Ctrl+K</code> anywhere on this page to jump straight to a project, template or page.
        </p>
      ),
    },
    {
      id: 'new-project',
      target: 'new-project',
      icon: 'lucide:square-plus',
      title: 'Create a project',
      placement: 'bottom',
      body: <p>A project is one canvas plus the infrastructure it describes. Create one here, then add resources on the canvas, start from a template, or import existing Terraform.</p>,
    },
    {
      id: 'checklist',
      target: 'checklist',
      icon: 'lucide:list-checks',
      title: 'Your first deploy',
      placement: 'bottom',
      body: (
        <p>
          Create a project, start the local sandbox with <code>whiparc sandbox up</code> in a terminal, then deploy. Each step ticks itself off as you complete it.
        </p>
      ),
    },
    {
      id: 'stats',
      target: 'stats',
      icon: 'lucide:gauge',
      title: 'Health at a glance',
      placement: 'bottom',
      body: <p>See when you last deployed, how many runs happened this week, and which projects have a failed latest run.</p>,
    },
    {
      id: 'projects',
      target: 'projects',
      icon: 'lucide:folder-open',
      title: 'Your projects',
      placement: 'bottom',
      body: (
        <p>
          Each card is a project. Open takes you to its canvas and the gear opens its settings; admins can also publish a project as a template. Discover lists public projects you can
          ask to join.
        </p>
      ),
    },
    {
      id: 'runs',
      target: 'runs',
      icon: 'lucide:activity',
      title: 'Recent runs',
      placement: 'top',
      body: <p>Every plan, deploy and destroy lands here with its target, duration and status. Click a row to open that project. The feed on the right shows what your team has been up to.</p>,
    },
    {
      id: 'tools',
      target: 'tools',
      icon: 'lucide:circle-help',
      title: 'Theme, and this tour',
      placement: 'bottom',
      body: <p>Switch between light and dark here. The ? button replays this tour whenever you want a refresher.</p>,
    },
  ];
}
