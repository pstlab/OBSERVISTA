import { h, type VNode } from 'snabbdom';
import { flick } from '@ratiosolver/flick';
import { auth_fetch } from '../main';
import { get_current_user } from './user';

export type AdminUserSummary = {
  username: string;
  role: 'User' | 'Admin';
  status: 'Pending' | 'Active';
  created_at: number;
};

let users_list: AdminUserSummary[] = [];
let loading = false;
let error_msg: string | null = null;
let approving_username: string | null = null;

export async function load_users(): Promise<void> {
  loading = true;
  error_msg = null;
  flick.redraw();

  try {
    const res = await auth_fetch('/api/users');
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error || `Failed to load users (${res.status})`);
    }
    users_list = (await res.json()) as AdminUserSummary[];
  } catch (err) {
    error_msg = err instanceof Error ? err.message : String(err);
  } finally {
    loading = false;
    flick.redraw();
  }
}

async function handle_approve(username: string): Promise<void> {
  if (approving_username) return;
  approving_username = username;
  error_msg = null;
  flick.redraw();

  try {
    const res = await auth_fetch(`/api/users/${encodeURIComponent(username)}/approve`, {
      method: 'POST',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error || `Failed to approve user (${res.status})`);
    }
    await load_users();
  } catch (err) {
    error_msg = err instanceof Error ? err.message : String(err);
  } finally {
    approving_username = null;
    flick.redraw();
  }
}

function format_timestamp(unix_secs: number): string {
  if (!unix_secs) return '-';
  return new Date(unix_secs * 1000).toLocaleString();
}

export function admin_users_page(): VNode {
  const current = get_current_user();
  if (!current || current.get_role() !== 'Admin') {
    return h('div.container.mt-5', [
      h('div.alert.alert-danger', 'Access denied. Administrator privileges required.'),
    ]);
  }

  const pending_users = users_list.filter((u) => u.status === 'Pending');
  const active_users = users_list.filter((u) => u.status === 'Active');

  return h('div.container.mt-5', [
    h('div.d-flex.justify-content-between.align-items-center.mb-4', [
      h('div', [
        h('h2.mb-1', [h('i.fas.fa-users-cog.me-2.text-primary'), 'User Management']),
        h('p.text-body-secondary.mb-0', 'Review and approve pending registration requests.'),
      ]),
      h(
        'button.btn.btn-outline-primary',
        {
          attrs: { type: 'button', disabled: loading },
          on: { click: () => load_users() },
        },
        [
          h(`i.fas.fa-sync-alt.me-2${loading ? '.fa-spin' : ''}`),
          loading ? 'Refreshing...' : 'Refresh',
        ]
      ),
    ]),

    ...(error_msg
      ? [h('div.alert.alert-danger', { attrs: { role: 'alert' } }, error_msg)]
      : []),

    h('div.card.mb-4', [
      h('div.card-header.d-flex.justify-content-between.align-items-center', [
        h('span.fw-semibold', 'Pending Approvals'),
        h('span.badge.bg-warning.text-dark', String(pending_users.length)),
      ]),
      h(
        'div.card-body.p-0',
        pending_users.length === 0
          ? [
            h(
              'p.text-body-secondary.p-3.mb-0',
              loading ? 'Loading users...' : 'No pending user registrations.'
            ),
          ]
          : [
            h('div.table-responsive', [
              h('table.table.table-hover.align-middle.mb-0', [
                h('thead.table-light', [
                  h('tr', [
                    h('th', 'Username'),
                    h('th', 'Role'),
                    h('th', 'Registered At'),
                    h('th.text-end', 'Action'),
                  ]),
                ]),
                h(
                  'tbody',
                  pending_users.map((u) =>
                    h('tr', [
                      h('td.fw-semibold', u.username),
                      h('td', h('span.badge.bg-secondary', u.role)),
                      h('td.text-body-secondary.small', format_timestamp(u.created_at)),
                      h(
                        'td.text-end',
                        h(
                          'button.btn.btn-sm.btn-success',
                          {
                            attrs: {
                              type: 'button',
                              disabled: approving_username === u.username,
                            },
                            on: { click: () => handle_approve(u.username) },
                          },
                          [
                            h('i.fas.fa-check.me-1'),
                            approving_username === u.username ? 'Approving...' : 'Approve',
                          ]
                        )
                      ),
                    ])
                  )
                ),
              ]),
            ]),
          ]
      ),
    ]),

    h('div.card', [
      h('div.card-header.d-flex.justify-content-between.align-items-center', [
        h('span.fw-semibold', 'Active Users'),
        h('span.badge.bg-success', String(active_users.length)),
      ]),
      h('div.card-body.p-0', [
        h('div.table-responsive', [
          h('table.table.table-sm.align-middle.mb-0', [
            h('thead.table-light', [
              h('tr', [
                h('th', 'Username'),
                h('th', 'Role'),
                h('th', 'Status'),
                h('th', 'Registered At'),
              ]),
            ]),
            h(
              'tbody',
              active_users.map((u) =>
                h('tr', [
                  h('td', u.username),
                  h(
                    'td',
                    h(
                      `span.badge.${u.role === 'Admin' ? 'bg-primary' : 'bg-secondary'}`,
                      u.role
                    )
                  ),
                  h('td', h('span.badge.bg-success', u.status)),
                  h('td.text-body-secondary.small', format_timestamp(u.created_at)),
                ])
              )
            ),
          ]),
        ]),
      ]),
    ]),
  ]);
}