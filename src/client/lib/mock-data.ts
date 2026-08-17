// Mock session data for the P1.1 static port — replaced by live agents in P1.3.
import type { Session } from '~shared/protocol'

const stripeCheckoutSnippet = `export async function POST(req: Request) {
  const { priceId, quantity } = await req.json()
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: priceId, quantity }],
    success_url: \`\${origin}/success?id={CHECKOUT_SESSION_ID}\`,
    cancel_url: \`\${origin}/cart\`,
  })
  return Response.json({ url: session.url })
}`

const failingTestLog = `FAIL  src/lib/rate-limit.test.ts > sliding window > drops burst
AssertionError: expected 429 to be 200
 ❯ src/lib/rate-limit.test.ts:42:31
    40|   const res = await limiter.check(ip)
    41|   await advanceBy(1_000)
    42|   expect(res.status).toBe(200)
      |                       ^
    43| })
Test Files  1 failed (1)
     Tests  1 failed | 7 passed (8)`

export const SESSIONS: Session[] = [
  {
    id: 's1',
    name: 'Add Stripe checkout flow',
    repo: 'acme/payments-web',
    branch: 'agent/stripe-checkout',
    status: 'running',
    region: 'iad1',
    model: 'claude-sonnet-4.5',
    createdAt: '2026-08-17T09:12:00Z',
    lastActivity: '2m',
    tokensIn: 184_320,
    tokensOut: 42_880,
    costUsd: 1.196,
    unread: true,
    subAgents: [
      {
        id: 'sa1',
        name: 'schema-migrator',
        task: 'Generate + apply orders/payments migration',
        status: 'running',
        progress: 62,
        model: 'claude-sonnet-4.5',
        tokensIn: 28_100,
        tokensOut: 9_400,
        steps: [
          { id: 'x1', label: 'Read prisma/schema.prisma', status: 'done' },
          { id: 'x2', label: 'Draft migration 0007_add_payments', status: 'done' },
          { id: 'x3', label: 'Run prisma migrate dev', detail: 'applying to shadow db', status: 'running' },
          { id: 'x4', label: 'Regenerate client', status: 'pending' },
        ],
      },
      {
        id: 'sa2',
        name: 'test-writer',
        task: 'Cover checkout route with integration tests',
        status: 'running',
        progress: 34,
        model: 'gpt-5-codex',
        tokensIn: 15_600,
        tokensOut: 6_200,
        steps: [
          { id: 'y1', label: 'Scaffold checkout.test.ts', status: 'done' },
          { id: 'y2', label: 'Mock Stripe client', status: 'running' },
          { id: 'y3', label: 'Assert success + cancel URLs', status: 'pending' },
        ],
      },
      {
        id: 'sa3',
        name: 'docs-writer',
        task: 'Update README payments section',
        status: 'queued',
        progress: 0,
        model: 'qwen3-coder',
        tokensIn: 0,
        tokensOut: 0,
        steps: [{ id: 'z1', label: 'Waiting for schema-migrator', status: 'pending' }],
      },
    ],
    messages: [
      {
        id: 'm1',
        role: 'user',
        createdAt: '2026-08-17T09:12:00Z',
        text: 'Add a Stripe checkout flow. Here is the route handler I started, please finish it and wire it to the cart. Validate price and quantity on the server.',
        pasted: [
          {
            id: 'p1',
            language: 'ts',
            lines: 10,
            chars: stripeCheckoutSnippet.length,
            content: stripeCheckoutSnippet,
          },
        ],
      },
      {
        id: 'm2',
        role: 'agent',
        createdAt: '2026-08-17T09:12:20Z',
        text: "I'll finish the checkout handler, recompute totals from server-side prices, and add a quantity cap. Spinning up sub-agents for the migration and tests in parallel.",
        steps: [
          { id: 's-1', label: 'Cloned acme/payments-web into sandbox iad1', status: 'done' },
          { id: 's-2', label: 'Installed dependencies', detail: 'pnpm install · 41s', status: 'done' },
          { id: 's-3', label: 'Read app/api/checkout/route.ts', status: 'done' },
          { id: 's-4', label: 'Editing checkout route', detail: 'server-side price lookup + qty cap', status: 'running' },
          { id: 's-5', label: 'Dispatched 3 sub-agents', status: 'done' },
        ],
        diff: [
          { file: 'app/api/checkout/route.ts', added: 38, removed: 12 },
          { file: 'lib/pricing.ts', added: 24, removed: 0 },
        ],
      },
    ],
  },
  {
    id: 's2',
    name: 'Fix flaky rate-limit test',
    repo: 'acme/edge-utils',
    branch: 'agent/fix-ratelimit-flake',
    status: 'review',
    region: 'sfo1',
    model: 'gpt-5-codex',
    createdAt: '2026-08-17T08:40:00Z',
    lastActivity: '18m',
    tokensIn: 96_400,
    tokensOut: 21_050,
    costUsd: 0.451,
    subAgents: [],
    messages: [
      {
        id: 'm1',
        role: 'user',
        createdAt: '2026-08-17T08:40:00Z',
        text: 'This test is flaky in CI. Figure out why and fix it without weakening the assertion.',
        pasted: [
          {
            id: 'p1',
            language: 'log',
            lines: 11,
            chars: failingTestLog.length,
            content: failingTestLog,
          },
        ],
      },
      {
        id: 'm2',
        role: 'agent',
        createdAt: '2026-08-17T08:41:10Z',
        text: 'The sliding window used wall-clock time; under CI load the fake timer drifted. I switched it to a monotonic injected clock so the burst window is deterministic. Tests pass 20/20 on repeat runs.',
        steps: [
          { id: 's-1', label: 'Reproduced flake', detail: 'seed loop · 3/50 failures', status: 'done' },
          { id: 's-2', label: 'Traced to Date.now() in limiter', status: 'done' },
          { id: 's-3', label: 'Injected clock dependency', status: 'done' },
          { id: 's-4', label: 'Ran vitest --repeat 20', detail: '20/20 pass', status: 'done' },
        ],
        diff: [
          { file: 'src/lib/rate-limit.ts', added: 16, removed: 9 },
          { file: 'src/lib/rate-limit.test.ts', added: 4, removed: 2 },
        ],
      },
    ],
  },
  {
    id: 's3',
    name: 'Migrate dashboard to Server Components',
    repo: 'acme/console',
    branch: 'agent/rsc-dashboard',
    status: 'idle',
    region: 'fra1',
    model: 'claude-opus-4.1',
    createdAt: '2026-08-16T22:05:00Z',
    lastActivity: '3h',
    tokensIn: 512_900,
    tokensOut: 148_300,
    costUsd: 18.816,
    subAgents: [],
    messages: [
      {
        id: 'm1',
        role: 'user',
        createdAt: '2026-08-16T22:05:00Z',
        text: 'Start migrating the analytics dashboard from client fetching to RSC. Keep the charts interactive.',
      },
      {
        id: 'm2',
        role: 'agent',
        createdAt: '2026-08-16T22:07:00Z',
        text: 'Moved data loading into the server layout and kept the Recharts pieces in a thin client boundary. Ready for your review on the first three panels.',
        steps: [
          { id: 's-1', label: 'Mapped client fetch call sites', detail: '11 components', status: 'done' },
          { id: 's-2', label: 'Converted 3 panels to RSC', status: 'done' },
          { id: 's-3', label: 'Paused for review', status: 'done' },
        ],
      },
    ],
  },
  {
    id: 's4',
    name: 'Upgrade to Tailwind v4',
    repo: 'acme/marketing',
    branch: 'agent/tw-v4',
    status: 'error',
    region: 'hnd1',
    model: 'gemini-2.5-pro',
    createdAt: '2026-08-16T19:30:00Z',
    lastActivity: '1d',
    tokensIn: 233_100,
    tokensOut: 60_400,
    costUsd: 0.895,
    subAgents: [],
    messages: [
      {
        id: 'm1',
        role: 'user',
        createdAt: '2026-08-16T19:30:00Z',
        text: 'Upgrade this project to Tailwind v4 and fix the config.',
      },
      {
        id: 'm2',
        role: 'agent',
        createdAt: '2026-08-16T19:33:00Z',
        text: "The codemod ran, but the build fails — a custom PostCSS plugin isn't compatible with the new pipeline. I need you to decide whether to drop it or pin it.",
        steps: [
          { id: 's-1', label: 'Ran @tailwindcss/upgrade', status: 'done' },
          { id: 's-2', label: 'Migrated tailwind.config.js to CSS', status: 'done' },
          { id: 's-3', label: 'Build failed', detail: 'postcss-nested incompatible', status: 'error' },
        ],
      },
    ],
  },
]

export { MODELS, GATEWAYS } from '~shared/models'
