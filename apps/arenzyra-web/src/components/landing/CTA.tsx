import Link from "next/link";

export function CTA() {
  return (
    <section className="py-16">
      <div className="mx-auto max-w-[1400px] px-6">
        <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,rgba(34,211,238,0.14),rgba(17,24,39,0.92),rgba(37,99,235,0.18))] px-8 py-16 text-center shadow-2xl shadow-black/30 sm:px-12">
          <div className="mx-auto max-w-2xl">
            <div className="text-sm font-medium uppercase tracking-[0.32em] text-cyan-300/80">
              Go Live Faster
            </div>
            <h2 className="mt-4 text-4xl font-bold text-white">
              Ready to run your next tournament?
            </h2>
            <p className="mt-4 text-gray-300">
              Sign in to configure brackets, control matches, and prepare your
              production stack for broadcast.
            </p>
            <div className="mt-8">
              <Link
                href="/login"
                prefetch={false}
                className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-6 py-3 text-sm font-semibold text-white transition hover:brightness-110"
              >
                Login
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
