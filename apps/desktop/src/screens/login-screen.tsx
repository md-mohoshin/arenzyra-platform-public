import { useState, type FormEvent } from "react";
import { DesktopBrandLockup } from "../components/desktop-brand-lockup";

type LoginScreenProps = {
  email: string;
  password: string;
  appVersion: string;
  busy: boolean;
  booting: boolean;
  error: string | null;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
};

export function LoginScreen(props: LoginScreenProps) {
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (props.busy || props.booting) {
      return;
    }
    props.onSubmit();
  };

  return (
    <div className="login-shell">
      <section className="login-card">
        <div className="login-copy">
          <DesktopBrandLockup
            size="sm"
            subtitle="Observer launcher access"
          />
          <h1>Sign in to the live desk</h1>
          <p>
            Use your Arenzyra organizer account to unlock match control,
            observer tools, and branded widget routing from this desktop
            station.
          </p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={props.email}
              onChange={(event) => props.onEmailChange(event.target.value)}
              placeholder="organizer@arenzyra.com"
              autoComplete="username"
              disabled={props.busy || props.booting}
            />
          </label>

          <label className="field">
            <span>Password</span>
            <div className="password-control">
              <input
                type={showPassword ? "text" : "password"}
                value={props.password}
                onChange={(event) => props.onPasswordChange(event.target.value)}
                placeholder="Password"
                autoComplete="current-password"
                disabled={props.busy || props.booting}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((current) => !current)}
                disabled={props.busy || props.booting}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </label>

          <button
            className="primary-button"
            type="submit"
            disabled={props.busy || props.booting}
          >
            {props.booting
              ? "Checking saved session..."
              : props.busy
                ? "Signing in..."
                : "Login"}
          </button>

          {props.error ? (
            <div className="status-card status-card--error">
              <strong>Authentication failed</strong>
              <p>{props.error}</p>
            </div>
          ) : null}

          <div className="login-version">v{props.appVersion}</div>
        </form>
      </section>
    </div>
  );
}
