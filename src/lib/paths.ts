// App paths shared across areas. Typed as plain strings so <Link to={paths.x}>
// compiles regardless of which phase adds the target route.
export const paths: Readonly<
  Record<
    | "home"
    | "login"
    | "signup"
    | "forgotPassword"
    | "authConfirm"
    | "setPassword"
    | "portal"
    | "portalProfile"
    | "portalOrders"
    | "portalOrderNew"
    | "admin",
    string
  >
> = {
  home: "/",
  login: "/login",
  signup: "/registreren",
  forgotPassword: "/wachtwoord-vergeten",
  authConfirm: "/auth/confirm",
  setPassword: "/auth/set-password",
  portal: "/portal",
  portalProfile: "/portal/profiel",
  portalOrders: "/portal/orders",
  /** Order registration; `?parent=<order id>` adds an extra package (see newOrderSearchSchema). */
  portalOrderNew: "/portal/orders/nieuw",
  admin: "/admin",
};
