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
  admin: "/admin",
};
