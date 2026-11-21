import '@fortawesome/fontawesome-free/css/all.css';
import { App, flick, Navbar, NavbarItem, NavbarList, Offcanvas, OffcanvasBody, OffcanvasBrand } from '@ratiosolver/flick';
import './style.css';
import { h, type VNode } from 'snabbdom';
import { UserButton, get_current_user, set_current_user } from './components/user';
import { admin_users_page, load_users } from './components/admin';

const ACCESS_TOKEN_KEY = 'observista_access_token';
const REFRESH_TOKEN_KEY = 'observista_refresh_token';

type TokenResponse = {
  username: string;
  role: 'User' | 'Admin';
  access_token: string;
  refresh_token: string;
  token_type: string;
};

type RegisterResponse = {
  username: string;
  status: 'Pending' | 'Active';
  message: string;
};

export type User = {
  username: string;
  role: 'User' | 'Admin';
};

function parse_user_from_token(token: string): User | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (typeof payload.sub === 'string' && (payload.role === 'User' || payload.role === 'Admin')) {
      return { username: payload.sub, role: payload.role };
    }
  } catch {
    // Token malformato
  }
  return null;
}

async function extract_error_message(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    if (typeof data?.error === 'string') {
      return data.error;
    }
  } catch {
    // Risposta non JSON
  }
  return `${fallback} (${res.status})`;
}

export async function login(username: string, password: string): Promise<User> {
  const login_res = await fetch('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!login_res.ok) {
    throw new Error(await extract_error_message(login_res, 'Login failed'));
  }

  const data = (await login_res.json()) as TokenResponse;
  if (!data.access_token || !data.refresh_token) {
    throw new Error('Login failed: missing token in response');
  }

  localStorage.setItem(ACCESS_TOKEN_KEY, data.access_token);
  localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);

  return { username: data.username, role: data.role };
}

export async function register(username: string, password: string): Promise<string> {
  const res = await fetch('/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    throw new Error(await extract_error_message(res, 'Registration failed'));
  }

  const data = (await res.json()) as RegisterResponse;
  return data.message;
}

export function logout(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  if (flick.ctx.current_page === admin_users_page) {
    flick.ctx.current_page = landing_page;
    flick.ctx.page_title = 'Home';
  }
}

async function try_refresh_tokens(): Promise<string | null> {
  const refresh_token = localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!refresh_token) return null;

  const res = await fetch('/refresh_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token }),
  });

  if (!res.ok) {
    logout();
    set_current_user(null);
    flick.redraw();
    return null;
  }

  const data = (await res.json()) as TokenResponse;
  localStorage.setItem(ACCESS_TOKEN_KEY, data.access_token);
  localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
  set_current_user({ username: data.username, role: data.role });
  return data.access_token;
}

export async function auth_fetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = localStorage.getItem(ACCESS_TOKEN_KEY);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let res = await fetch(input, { ...init, headers });
  if (res.status === 401 && localStorage.getItem(REFRESH_TOKEN_KEY)) {
    const new_token = await try_refresh_tokens();
    if (new_token) {
      headers.set('Authorization', `Bearer ${new_token}`);
      res = await fetch(input, { ...init, headers });
    }
  }
  return res;
}

const stored_token = localStorage.getItem(ACCESS_TOKEN_KEY);
if (stored_token) {
  set_current_user(parse_user_from_token(stored_token));
}

const landing_page = () => h('div.container.mt-5', [
  h('header.text-center.mb-5', [
    h('h1.display-4', 'OBSERVISTA'),
    h('p.lead.text-body-secondary', 'Observatory of Innovative Strategies for Repurposing Terrain Vague'),
  ]),
  h('div.row.justify-content-center', [
    h('div.col-lg-8', [
      h('p', 'OBSERVISTA aims to innovate our approach to urban vacant spaces—commonly known as "terrain vague"—by creating a pan-European knowledge hub for innovative repurposing strategies. This digital tool provides an accessible interface to explore, query, and spatially contextualize the Action\'s ontology-based terminology.'),
      h('hr.my-4'),
      h('h4', 'Features'),
      h('ul.list-group.list-group-flush', [
        h('li.list-group-item', [h('i.fas.fa-sitemap.me-2.text-primary'), h('strong', 'Ontology-Based Terminology'), ': Systematizes diverse definitions, interpretations, and conceptualizations of terrain vague across disciplines and cultural contexts.']),
        h('li.list-group-item', [h('i.fas.fa-search.me-2.text-primary'), h('strong', 'Accessible Exploration'), ': Abstracts the complexity of formal semantic languages, enabling urbanists, planners, and designers to seamlessly search and compare terms.']),
        h('li.list-group-item', [h('i.fas.fa-map-marked-alt.me-2.text-primary'), h('strong', 'Geospatial Contextualization'), ': Integrates interactive Leaflet maps to link abstract ontological concepts directly to physical locations and European case studies.']),
        h('li.list-group-item', [h('i.fas.fa-cogs.me-2.text-primary'), h('strong', 'Semantic Reasoning Integration'), ': Powered by a high-performance Rust backend interfacing with semantic reasoners to evaluate queries and infer conceptual relationships.']),
      ]),
      h('hr.my-4'),
      h('p', [
        'The platform bridges the gap between theoretical research in ', h('strong', 'Applied Ontology (WG1)'), ' and empirical analysis of ', h('strong', 'Repurposing in Practice (WG2)'), '. Users can navigate hierarchies of concepts, inspect ', h('i', 'prototypical definitions'), ', and explore ', h('i', 'expected uses'), ' of terms without requiring prior expertise in formal languages or RDF/OWL structures.',
      ]),
      h('p', [
        'By connecting terminology to ', h('strong', 'spatial case studies'), ', the tool supports the development of a common pan-European language around underused urban spaces, transforming fragmented disciplinary perspectives into actionable insights for climate resilience, ecological regeneration, and social inclusion.',
      ]),
      h('p.text-body-secondary.small.mt-4', [
        'Developed within the framework of ', h('strong', 'COST Action CA24134 (VMG 03)'), ' — Observatory of Innovative Strategies for Repurposing Terrain Vague.',
      ]),
    ])
  ])
]);

flick.ctx.current_page = landing_page;
flick.ctx.page_title = 'Home';

flick.mount(() => OBSERVISTAApp());

function OBSERVISTAApp(): VNode {
  const is_admin = get_current_user()?.get_role() === 'Admin';

  const nav_items = [
    NavbarItem(
      h('i.fas.fa-home'),
      () => {
        flick.ctx.current_page = landing_page;
        flick.ctx.page_title = 'Home';
        flick.redraw();
      },
      flick.ctx.current_page === landing_page,
      'Home'
    ),
    ...(is_admin
      ? [
        NavbarItem(
          h('i.fas.fa-users-cog'),
          () => {
            flick.ctx.current_page = admin_users_page;
            flick.ctx.page_title = 'Users';
            void load_users();
            flick.redraw();
          },
          flick.ctx.current_page === admin_users_page,
          'Users'
        ),
      ]
      : []),
  ];

  const content = h('div.flex-grow-1.d-flex.flex-column', [
    (flick.ctx.current_page as () => VNode)(),
    Offcanvas(OffcanvasBody([])),
  ]);

  return App(
    Navbar(OffcanvasBrand('OBSERVISTA'), [
      NavbarList(nav_items),
      UserButton(),
    ]),
    content
  );
}