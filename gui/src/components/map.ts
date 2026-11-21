import { h, type VNode } from 'snabbdom';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Offcanvas as BootstrapOffcanvas } from 'bootstrap';
import { flick, OffcanvasBody, OffcanvasHeader } from '@ratiosolver/flick';
import { auth_fetch } from '../main';
import { get_current_user } from './user';

// Fix icone marker di default con bundler Vite
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

export type TerrainVagueDto = {
  uri: string;
  name: string;
  description?: string | null;
  typology?: string | null;
  wkt: string;
  geojson?: string | null;
};

let sites: TerrainVagueDto[] = [];
let selected_site: TerrainVagueDto | null = null;
let loading = false;
let error_msg: string | null = null;

// Stato form creazione (visibile solo agli utenti loggati)
let show_create_form = false;
let new_name = '';
let new_description = '';
let new_typology = '';
let new_wkt = '';
let creating = false;

let map_instance: L.Map | null = null;
let layers_group: L.LayerGroup | null = null;
const site_layers = new Map<string, L.Layer>();

function show_offcanvas(): void {
  const el = document.getElementById('offcanvasNavbar');
  if (el) {
    BootstrapOffcanvas.getOrCreateInstance(el).show();
  }
}

function parse_coord_pair(pair: string): L.LatLngTuple | null {
  const parts = pair.trim().split(/\s+/).map(Number);
  if (parts.length >= 2 && !Number.isNaN(parts[0]) && !Number.isNaN(parts[1])) {
    // WKT usa (lon lat), Leaflet usa [lat, lon]
    return [parts[1], parts[0]];
  }
  return null;
}

function layer_from_site(site: TerrainVagueDto): L.Layer | null {
  if (site.geojson) {
    try {
      return L.geoJSON(JSON.parse(site.geojson));
    } catch {
      // Fallback su WKT
    }
  }

  const wkt = site.wkt.trim();
  const pointMatch = wkt.match(/^POINT\s*\(([^)]+)\)/i);
  if (pointMatch) {
    const coord = parse_coord_pair(pointMatch[1]);
    return coord ? L.marker(coord) : null;
  }

  const lineMatch = wkt.match(/^LINESTRING\s*\(([^)]+)\)/i);
  if (lineMatch) {
    const coords = lineMatch[1]
      .split(',')
      .map(parse_coord_pair)
      .filter((c): c is L.LatLngTuple => c !== null);
    return coords.length > 0 ? L.polyline(coords, { color: '#0d6efd' }) : null;
  }

  const polyMatch = wkt.match(/^POLYGON\s*\(\(([^)]+)\)\)/i);
  if (polyMatch) {
    const coords = polyMatch[1]
      .split(',')
      .map(parse_coord_pair)
      .filter((c): c is L.LatLngTuple => c !== null);
    return coords.length > 0 ? L.polygon(coords, { color: '#dc3545', fillOpacity: 0.25 }) : null;
  }

  return null;
}

function render_sites_on_map(fit_bounds = false): void {
  if (!map_instance || !layers_group) return;

  layers_group.clearLayers();
  site_layers.clear();

  const bounds = L.latLngBounds([]);

  for (const site of sites) {
    const layer = layer_from_site(site);
    if (!layer) continue;

    layer.bindTooltip(site.name);
    layer.on('click', () => {
      selected_site = site;
      show_create_form = false;
      flick.redraw();
      show_offcanvas();
    });

    layers_group.addLayer(layer);
    site_layers.set(site.uri, layer);

    if (layer instanceof L.Marker) {
      bounds.extend(layer.getLatLng());
    } else if ('getBounds' in layer && typeof (layer as L.Polygon).getBounds === 'function') {
      const b = (layer as L.Polygon).getBounds();
      if (b.isValid()) bounds.extend(b);
    }
  }

  if (fit_bounds && bounds.isValid()) {
    map_instance.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }
}

export async function load_terrain_vagues(fit_bounds = true): Promise<void> {
  loading = true;
  error_msg = null;
  flick.redraw();

  try {
    const res = await fetch('/api/terrain-vague');
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error || `Failed to fetch terrain vagues (${res.status})`);
    }
    sites = (await res.json()) as TerrainVagueDto[];
    if (selected_site) {
      selected_site = sites.find((s) => s.uri === selected_site?.uri) ?? null;
    }
    render_sites_on_map(fit_bounds);
  } catch (err) {
    error_msg = err instanceof Error ? err.message : String(err);
  } finally {
    loading = false;
    flick.redraw();
  }
}

function focus_site(site: TerrainVagueDto): void {
  selected_site = site;
  show_create_form = false;
  flick.redraw();

  const layer = site_layers.get(site.uri);
  if (!map_instance || !layer) return;

  if (layer instanceof L.Marker) {
    map_instance.setView(layer.getLatLng(), 16);
  } else if ('getBounds' in layer && typeof (layer as L.Polygon).getBounds === 'function') {
    map_instance.fitBounds((layer as L.Polygon).getBounds(), { padding: [40, 40], maxZoom: 16 });
  }
}

async function handle_create_site(event: Event): Promise<void> {
  event.preventDefault();
  if (creating || !new_name.trim() || !new_wkt.trim()) return;

  creating = true;
  error_msg = null;
  flick.redraw();

  try {
    const res = await auth_fetch('/api/terrain-vague', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: new_name.trim(),
        description: new_description.trim() || null,
        typology: new_typology.trim() || null,
        wkt: new_wkt.trim(),
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error || `Failed to create site (${res.status})`);
    }

    const created = (await res.json()) as TerrainVagueDto;
    new_name = '';
    new_description = '';
    new_typology = '';
    new_wkt = '';
    show_create_form = false;
    selected_site = created;
    await load_terrain_vagues(false);
    focus_site(created);
  } catch (err) {
    error_msg = err instanceof Error ? err.message : String(err);
  } finally {
    creating = false;
    flick.redraw();
  }
}

export function map_page(): VNode {
  return h('div.position-relative.flex-grow-1.d-flex.flex-column', [
    // Barra pulsanti flottante sopra la mappa per aprire l'Offcanvas
    h(
      'div.position-absolute.top-0.end-0.m-3.d-flex.gap-2',
      { style: { zIndex: '1000' } },
      [
        h(
          'button.btn.btn-light.shadow-sm.border',
          {
            attrs: {
              type: 'button',
              'data-bs-toggle': 'offcanvas',
              'data-bs-target': '#offcanvasNavbar',
              'aria-controls': 'offcanvasNavbar',
            },
          },
          [
            h('i.fas.fa-layer-group.me-2.text-primary'),
            `Sites (${sites.length})`,
          ]
        ),
        h(
          'button.btn.btn-light.shadow-sm.border',
          {
            attrs: { type: 'button', disabled: loading, title: 'Reload sites' },
            on: { click: () => load_terrain_vagues(true) },
          },
          [h(`i.fas.fa-sync-alt${loading ? '.fa-spin' : ''}`)]
        ),
      ]
    ),
    h('div#observista-map.flex-grow-1', {
      style: { minHeight: 'calc(100vh - 56px)', width: '100%' },
      hook: {
        insert: (vnode) => {
          const el = vnode.elm as HTMLElement;
          map_instance = L.map(el).setView([41.9028, 12.4964], 6);

          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors',
            maxZoom: 19,
          }).addTo(map_instance);

          layers_group = L.layerGroup().addTo(map_instance);

          // Se il form di creazione è aperto, cliccare sulla mappa compila il WKT POINT
          map_instance.on('click', (e: L.LeafletMouseEvent) => {
            if (show_create_form) {
              new_wkt = `POINT(${e.latlng.lng.toFixed(6)} ${e.latlng.lat.toFixed(6)})`;
              flick.redraw();
            }
          });

          render_sites_on_map(true);
        },
        destroy: () => {
          map_instance?.remove();
          map_instance = null;
          layers_group = null;
          site_layers.clear();
        },
      },
    }),
  ]);
}

export function MapOffcanvasHeader(): VNode {
  const title = show_create_form
    ? 'New Terrain Vague'
    : selected_site
      ? selected_site.name
      : 'Terrain Vague Explorer';
  return OffcanvasHeader(title);
}

export function MapOffcanvasBody(): VNode {
  const logged_in = get_current_user() !== null;

  return OffcanvasBody([
    ...(error_msg
      ? [h('div.alert.alert-danger.py-2.small', { attrs: { role: 'alert' } }, error_msg)]
      : []),

    // Barra azioni superiore nell'Offcanvas
    h('div.d-flex.justify-content-between.align-items-center.mb-3', [
      selected_site || show_create_form
        ? h(
          'button.btn.btn-sm.btn-outline-secondary',
          {
            attrs: { type: 'button' },
            on: {
              click: () => {
                selected_site = null;
                show_create_form = false;
                flick.redraw();
              },
            },
          },
          [h('i.fas.fa-arrow-left.me-1'), 'All sites']
        )
        : h('span.text-body-secondary.small', `${sites.length} sites in knowledge base`),

      ...(logged_in && !show_create_form
        ? [
          h(
            'button.btn.btn-sm.btn-primary',
            {
              attrs: { type: 'button' },
              on: {
                click: () => {
                  selected_site = null;
                  show_create_form = true;
                  flick.redraw();
                },
              },
            },
            [h('i.fas.fa-plus.me-1'), 'Add Site']
          ),
        ]
        : []),
    ]),

    // Vista 1: Form creazione (solo utenti autenticati)
    ...(show_create_form
      ? [
        h('form', { on: { submit: handle_create_site } }, [
          h('div.mb-2', [
            h('label.form-label.small', 'Site Name *'),
            h('input.form-control.form-control-sm', {
              attrs: { type: 'text', required: true },
              props: { value: new_name },
              on: { input: (e: Event) => (new_name = (e.target as HTMLInputElement).value) },
            }),
          ]),
          h('div.mb-2', [
            h('label.form-label.small', 'Typology (local name, e.g. Industrial)'),
            h('input.form-control.form-control-sm', {
              attrs: { type: 'text', placeholder: 'Optional' },
              props: { value: new_typology },
              on: { input: (e: Event) => (new_typology = (e.target as HTMLInputElement).value) },
            }),
          ]),
          h('div.mb-2', [
            h('label.form-label.small', 'Description'),
            h('textarea.form-control.form-control-sm', {
              attrs: { rows: 2 },
              props: { value: new_description },
              on: {
                input: (e: Event) => (new_description = (e.target as HTMLTextAreaElement).value),
              },
            }),
          ]),
          h('div.mb-3', [
            h('label.form-label.small', 'Geometry (WKT) *'),
            h('input.form-control.form-control-sm.font-monospace', {
              attrs: {
                type: 'text',
                placeholder: 'POINT(12.49 41.89) or click map',
                required: true,
              },
              props: { value: new_wkt },
              on: { input: (e: Event) => (new_wkt = (e.target as HTMLInputElement).value) },
            }),
            h('div.form-text', 'Click anywhere on the map to fill POINT coordinates.'),
          ]),
          h(
            'button.btn.btn-sm.btn-success.w-100',
            { attrs: { type: 'submit', disabled: creating } },
            creating ? 'Saving to Fuseki...' : 'Save Terrain Vague'
          ),
        ]),
      ]
      : // Vista 2: Dettaglio sito selezionato
      selected_site
        ? [
          h('div.mb-3', [
            ...(selected_site.typology
              ? [h('span.badge.bg-primary.mb-2', selected_site.typology)]
              : []),
            h(
              'p.mb-2',
              selected_site.description || h('span.text-body-secondary.fst-italic', 'No description provided.')
            ),
            h('hr'),
            h('div.small.text-body-secondary.mb-1', 'Ontological URI'),
            h('code.small.d-block.text-break.mb-3', selected_site.uri),
            h('div.small.text-body-secondary.mb-1', 'GeoSPARQL WKT'),
            h('code.small.d-block.text-break.bg-light.p-2.rounded', selected_site.wkt),
          ]),
        ]
        : // Vista 3: Elenco completo dei siti
        [
          sites.length === 0
            ? h(
              'p.text-body-secondary.small',
              loading ? 'Loading sites from Fuseki...' : 'No Terrain Vague sites found.'
            )
            : h(
              'div.list-group.list-group-flush',
              sites.map((site) =>
                h(
                  'button.list-group-item.list-group-item-action.px-2',
                  {
                    attrs: { type: 'button' },
                    on: { click: () => focus_site(site) },
                  },
                  [
                    h('div.d-flex.justify-content-between.align-items-start', [
                      h('strong.small', site.name),
                      ...(site.typology
                        ? [h('span.badge.bg-secondary.ms-2', site.typology)]
                        : []),
                    ]),
                    ...(site.description
                      ? [h('div.text-body-secondary.small.text-truncate', site.description)]
                      : []),
                  ]
                )
              )
            ),
        ]),
  ]);
}