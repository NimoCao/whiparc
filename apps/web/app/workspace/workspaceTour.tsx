import type { TourStep } from '../components/ProductTour';

// Steps for the first-visit workspace tour. Each `target` matches a
// `data-tour` attribute in the workspace files (page.tsx, WorkspaceHeaderV2,
// LibraryPanelV2, ConsoleBar). Steps are listed in the order the eye moves
// across the screen: library, canvas, sandbox chip, inspector, then the
// header, then the console. Copy only describes behavior that exists today.
//
// With `interactive`, the library and canvas steps ask the user to actually
// add two nodes and connect them (the page reports completion from the canvas
// store); otherwise they only describe it, which is what a read-only viewer or
// a project that already has content gets.
export function getWorkspaceTourSteps({ interactive }: { interactive: boolean }): TourStep[] {
  const library: TourStep = interactive
    ? {
        id: 'library',
        target: 'workarea',
        icon: 'lucide:blocks',
        title: 'Add two nodes',
        placement: 'bottom',
        body: <p>The library on the left holds every node you can build with. Click a node to add it, or drag it onto the canvas. Add any two to continue.</p>,
        task: { prompt: 'Waiting for you to add two nodes.', done: 'Two nodes on the canvas.', allow: ['library', 'canvas'] },
      }
    : {
        id: 'library',
        target: 'library',
        icon: 'lucide:blocks',
        title: 'The node library',
        placement: 'right',
        body: <p>Drag a node onto the canvas, or click it to add it. Search by name, or filter by Terraform, Ansible, Kubernetes or Target. You can author your own custom node from here too.</p>,
      };

  const canvas: TourStep = interactive
    ? {
        id: 'canvas',
        target: 'canvas',
        icon: 'lucide:workflow',
        title: 'Connect them',
        placement: 'bottom',
        body: (
          <p>
            Drag from the small square on the edge of one node to the other node to connect them. Drag empty space to pan and scroll to zoom. The nodes you added stay on the canvas: select one and
            press Backspace to remove it.
          </p>
        ),
        task: { prompt: 'Waiting for a connection. You need two nodes first.', done: 'Connected. Connections decide the order things run in.', allow: ['canvas'] },
      }
    : {
        id: 'canvas',
        target: 'canvas',
        icon: 'lucide:workflow',
        title: 'The canvas',
        placement: 'bottom',
        body: (
          <p>
            Drag a node to move it, and drag from the square handle on its edge to another node to connect them. Drag empty space to pan and scroll to zoom; the zoom controls are bottom-left.
            Click a node or a connection to edit it.
          </p>
        ),
      };

  return [
    {
      id: 'welcome',
      icon: 'lucide:layout-template',
      title: 'Welcome to your workspace',
      body: (
        <>
          <p>This is where a project lives. You draw infrastructure as a graph, Whiparc compiles it to Terraform, Ansible and Kubernetes code, and you run it in your sandbox.</p>
          <p>A quick look at what is where.</p>
        </>
      ),
    },
    library,
    canvas,
    {
      id: 'sandbox',
      target: 'sandbox',
      icon: 'lucide:container',
      title: 'Your sandbox',
      placement: 'bottom',
      body: (
        <p>
          Deploys to the sandbox run through your local sandbox agent. Start it with <code>whiparc sandbox up</code> in a terminal and this chip turns online once it connects.
        </p>
      ),
    },
    {
      id: 'inspector',
      target: 'inspector',
      icon: 'lucide:sliders-horizontal',
      title: 'The inspector',
      placement: 'left',
      body: <p>Select a node or a connection to edit its parameters here. With nothing selected you get a summary of the whole canvas.</p>,
    },
    {
      id: 'views',
      target: 'views',
      icon: 'lucide:panels-top-left',
      title: 'Canvas, Variables, Code Preview',
      placement: 'bottom',
      body: <p>Canvas is where you build. Variables lists the Terraform variables your nodes produce, and Code Preview shows the Terraform, Ansible and Kubernetes compiled from the canvas.</p>,
    },
    {
      id: 'project-tools',
      target: 'project-tools',
      icon: 'lucide:settings',
      title: 'Settings and history',
      placement: 'bottom',
      body: (
        <p>
          The gear opens project settings: visibility, members, cloud credentials and sandbox agents. The clock is the deploy history: a checkpoint of the canvas is saved after every deploy, and
          you can revert to one.
        </p>
      ),
    },
    {
      id: 'actions',
      target: 'actions',
      icon: 'lucide:rocket',
      title: 'Preview, Plan and Deploy',
      placement: 'bottom',
      body: (
        <p>
          Preview shows the compiled code. Plan runs a real <code>terraform plan</code> and changes nothing. Deploy applies the canvas to your sandbox. The ⋯ menu has Export, Auto-cleanup (on by
          default: it destroys the resources after a deploy), Clear canvas and Destroy.
        </p>
      ),
    },
    {
      id: 'console',
      target: 'console',
      icon: 'lucide:terminal',
      title: 'The console',
      placement: 'top',
      body: <p>Runner output streams here while a plan or deploy runs. Click the bar to expand it into the full log.</p>,
    },
    {
      id: 'help',
      target: 'help',
      icon: 'lucide:circle-help',
      title: 'Replay this tour',
      placement: 'bottom',
      body: <p>That is the workspace. The ? button brings this tour back whenever you want a refresher.</p>,
    },
  ];
}
