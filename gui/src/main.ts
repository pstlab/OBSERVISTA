import '@fortawesome/fontawesome-free/css/all.css';
import { App, flick, Navbar, NavbarItem, NavbarList, Offcanvas, OffcanvasBody, OffcanvasBrand } from '@ratiosolver/flick';
import './style.css'
import { h, type VNode } from 'snabbdom';
import { UserButton } from './components/user';

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
  const content = h('div.flex-grow-1.d-flex.flex-column', [
    (flick.ctx.current_page as () => VNode)(),
    Offcanvas(
      OffcanvasBody([
      ]))
  ]);

  return App(Navbar(OffcanvasBrand('OBSERVISTA'), [NavbarList([NavbarItem(h('i.fas.fa-home'), () => {
    flick.ctx.current_page = landing_page;
    flick.ctx.page_title = 'Home';
    flick.redraw();
  }, false, 'Home'),
  ]), UserButton()]), content);
}

export async function login(username: string, password: string): Promise<void> {
  const login_res = await fetch('/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  if (!login_res.ok) {
    throw new Error(`Login failed: ${login_res.status} ${login_res.statusText}`.trim());
  }
  const data = await login_res.json() as Token;
  if (!data.access_token || !data.refresh_token) {
    throw new Error('Login failed: missing token in response');
  }
}

type Token = { access_token: string, refresh_token: string, token_type: string };
export type User = { username: string, role: 'User' | 'Admin' };
