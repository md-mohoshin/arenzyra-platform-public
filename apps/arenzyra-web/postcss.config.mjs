const config = {
  plugins: {
    "@tailwindcss/postcss": {
      // Limit automatic class scanning to this app instead of the monorepo root.
      base: import.meta.dirname,
    },
  },
};

export default config;
