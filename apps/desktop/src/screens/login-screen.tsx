import { useState, type FormEvent } from "react";

type LoginScreenProps = {
  email: string;
  password: string;
  keepSignedIn: boolean;
  appVersion: string;
  busy: boolean;
  booting: boolean;
  error: string | null;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onKeepSignedInChange: (value: boolean) => void;
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
          <span className="eyebrow">Arenzyra Observer Launcher</span>
          <h1>Organizer authentication required.</h1>
          <p>
            Sign in with your Arenzyra organizer account to load production
            tournaments, stages, and matches scoped to your organization.
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

          <label className="login-check-row">
            <input
              type="checkbox"
              checked={props.keepSignedIn}
              onChange={(event) =>
                props.onKeepSignedInChange(event.target.checked)
              }
              disabled={props.busy || props.booting}
            />
            <span>
              <strong>Keep me signed in</strong>
              <small>
                {props.keepSignedIn
                  ? "The launcher will restore your encrypted session next time."
                  : "You will be signed out when the launcher closes."}
              </small>
            </span>
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

          <div
            className={`status-card ${
              props.error ? "status-card--error" : "status-card--neutral"
            }`}
          >
            <strong>{props.error ? "Authentication failed" : "Organizer access"}</strong>
            <p>
              {props.error ||
                "Only authenticated organizers can access production matches in this launcher."}
            </p>
          </div>

          <div className="login-version">
            Arenzyra Observer Launcher v{props.appVersion}
          </div>
        </form>
      </section>
    </div>
  );
}
