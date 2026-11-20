import { h, type VNode } from "snabbdom";
import { Dropdown, Modal } from "bootstrap";
import { flick } from "@ratiosolver/flick";
import { login, register, logout, type User } from "../main";

let username = "";
let password = "";
let confirmPassword = "";
let mode: "login" | "register" = "login";
let feedback: { type: "danger" | "success"; text: string } | null = null;
let submitting = false;
let current_user: OBSERVISTAUser | null = null;

class OBSERVISTAUser {
  private readonly username: string;
  private readonly role: "User" | "Admin";

  constructor(user: User) {
    this.username = user.username;
    this.role = user.role;
  }

  get_username(): string {
    return this.username;
  }

  get_role(): "User" | "Admin" {
    return this.role;
  }
}

export function set_current_user(user: User | null): void {
  current_user = user ? new OBSERVISTAUser(user) : null;
}

export function get_current_user(): OBSERVISTAUser | null {
  return current_user;
}

function reset_form(nextMode: "login" | "register" = "login"): void {
  mode = nextMode;
  username = "";
  password = "";
  confirmPassword = "";
  feedback = null;
  submitting = false;
}

export function UserButton(): VNode {
  let authModal: Modal | null = null;
  let dropdown: Dropdown | null = null;

  const openModal = (initialMode: "login" | "register") => {
    reset_form(initialMode);
    flick.redraw();
    authModal?.show();
  };

  const handleSubmit = async (event?: Event) => {
    event?.preventDefault();
    if (submitting) return;

    const trimmedUser = username.trim();
    if (!trimmedUser || !password) {
      feedback = { type: "danger", text: "Please enter username and password." };
      flick.redraw();
      return;
    }

    if (mode === "register") {
      if (trimmedUser.length < 3) {
        feedback = { type: "danger", text: "Username must be at least 3 characters." };
        flick.redraw();
        return;
      }
      if (password.length < 8) {
        feedback = { type: "danger", text: "Password must be at least 8 characters." };
        flick.redraw();
        return;
      }
      if (password !== confirmPassword) {
        feedback = { type: "danger", text: "Passwords do not match." };
        flick.redraw();
        return;
      }
    }

    submitting = true;
    feedback = null;
    flick.redraw();

    try {
      if (mode === "login") {
        const user = await login(trimmedUser, password);
        set_current_user(user);
        authModal?.hide();
        reset_form("login");
      } else {
        const msg = await register(trimmedUser, password);
        reset_form("login");
        username = trimmedUser;
        feedback = {
          type: "success",
          text: msg || "Registration submitted. Pending administrator approval."
        };
      }
    } catch (error) {
      feedback = {
        type: "danger",
        text: error instanceof Error ? error.message : String(error)
      };
    } finally {
      submitting = false;
      flick.redraw();
    }
  };

  return h("div.btn-group", [
    h(
      "button.btn.dropdown-toggle",
      {
        attrs: { "data-bs-toggle": "dropdown" },
        hook: {
          insert: (vnode) => {
            dropdown = Dropdown.getOrCreateInstance(vnode.elm as Element);
          },
          update: (_old, vnode) => {
            dropdown = Dropdown.getOrCreateInstance(vnode.elm as Element);
          },
          destroy: () => {
            dropdown?.dispose();
            dropdown = null;
          }
        },
        on: { click: () => dropdown?.toggle() }
      },
      [
        h("i.fas.fa-user-circle"),
        ...(current_user ? [h("span.ms-1", current_user.get_username())] : [])
      ]
    ),
    h(
      "ul.dropdown-menu.dropdown-menu-end",
      current_user
        ? [
          h("li.dropdown-header", `${current_user.get_username()} (${current_user.get_role()})`),
          h("li", h("hr.dropdown-divider")),
          h(
            "li",
            h(
              "button.dropdown-item",
              {
                on: {
                  click: () => {
                    logout();
                    set_current_user(null);
                    flick.redraw();
                  }
                }
              },
              "Logout"
            )
          )
        ]
        : [
          h(
            "li",
            h(
              "button.dropdown-item",
              {
                on: { click: () => openModal("login") }
              },
              "Login"
            )
          ),
          h(
            "li",
            h(
              "button.dropdown-item",
              {
                on: { click: () => openModal("register") }
              },
              "Register"
            )
          )
        ]
    ),
    h(
      "div.modal.fade",
      {
        hook: {
          insert: (vnode) => {
            const modalElement = vnode.elm as Element;
            authModal = Modal.getOrCreateInstance(modalElement);
            modalElement.addEventListener("hide.bs.modal", () => {
              const userButton = document.querySelector(
                ".btn-group .btn.dropdown-toggle"
              ) as HTMLButtonElement | null;
              if (userButton) {
                setTimeout(() => userButton.focus(), 0);
              }
            });
          },
          update: (_old, vnode) => {
            authModal = Modal.getOrCreateInstance(vnode.elm as Element);
          },
          destroy: () => {
            authModal?.dispose();
            authModal = null;
          }
        }
      },
      [
        h("div.modal-dialog", [
          h("div.modal-content", [
            h("div.modal-header", [
              h("h5.modal-title", mode === "login" ? "Login" : "Register"),
              h("button.btn-close", {
                attrs: {
                  type: "button",
                  "data-bs-dismiss": "modal",
                  "aria-label": "Close"
                }
              })
            ]),
            h("div.modal-body", [
              ...(feedback
                ? [h(`div.alert.alert-${feedback.type}.py-2`, { attrs: { role: "alert" } }, feedback.text)]
                : []),
              h("form", { on: { submit: handleSubmit } }, [
                h("div.mb-3", [
                  h("label.form-label", { attrs: { for: "observista-auth-username" } }, "Username"),
                  h("input.form-control", {
                    attrs: {
                      id: "observista-auth-username",
                      type: "text",
                      autocomplete: "username",
                      required: true
                    },
                    props: { value: username },
                    on: {
                      input: (event: Event) => {
                        username = (event.target as HTMLInputElement).value;
                      }
                    }
                  })
                ]),
                h("div.mb-3", [
                  h("label.form-label", { attrs: { for: "observista-auth-password" } }, "Password"),
                  h("input.form-control", {
                    attrs: {
                      id: "observista-auth-password",
                      type: "password",
                      autocomplete: mode === "login" ? "current-password" : "new-password",
                      required: true
                    },
                    props: { value: password },
                    on: {
                      input: (event: Event) => {
                        password = (event.target as HTMLInputElement).value;
                      }
                    }
                  })
                ]),
                ...(mode === "register"
                  ? [
                    h("div.mb-3", [
                      h(
                        "label.form-label",
                        { attrs: { for: "observista-auth-confirm-password" } },
                        "Confirm Password"
                      ),
                      h("input.form-control", {
                        attrs: {
                          id: "observista-auth-confirm-password",
                          type: "password",
                          autocomplete: "new-password",
                          required: true
                        },
                        props: { value: confirmPassword },
                        on: {
                          input: (event: Event) => {
                            confirmPassword = (event.target as HTMLInputElement).value;
                          }
                        }
                      })
                    ])
                  ]
                  : [])
              ])
            ]),
            h("div.modal-footer.justify-content-between", [
              h(
                "button.btn.btn-link.p-0.text-decoration-none",
                {
                  attrs: { type: "button" },
                  on: {
                    click: () => {
                      reset_form(mode === "login" ? "register" : "login");
                      flick.redraw();
                    }
                  }
                },
                mode === "login" ? "Need an account? Register" : "Already have an account? Login"
              ),
              h("div.d-flex.gap-2", [
                h(
                  "button.btn.btn-secondary",
                  {
                    attrs: {
                      type: "button",
                      "data-bs-dismiss": "modal"
                    }
                  },
                  "Cancel"
                ),
                h(
                  "button.btn.btn-primary",
                  {
                    attrs: { type: "button", disabled: submitting },
                    on: { click: () => handleSubmit() }
                  },
                  submitting
                    ? "Please wait..."
                    : mode === "login"
                      ? "Login"
                      : "Register"
                )
              ])
            ])
          ])
        ])
      ]
    )
  ]);
}