"use strict";

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
}

function normalizeBrandingContext(value) {
  const source = value && typeof value === "object" ? value : {};
  const organization =
    source.organization && typeof source.organization === "object"
      ? source.organization
      : {};
  const branding =
    source.branding && typeof source.branding === "object"
      ? source.branding
      : organization.branding && typeof organization.branding === "object"
        ? organization.branding
        : null;
  const organizationId =
    asString(source.organizationId) || asString(organization.id) || null;
  const organizationSlug =
    asString(source.organizationSlug) || asString(organization.slug) || null;
  const organizationName =
    asString(source.organizationName) || asString(organization.name) || null;
  const brandingApiUrl = asString(source.brandingApiUrl) || null;

  return {
    organizationId,
    organizationSlug,
    brandingApiUrl,
    organization:
      organizationId || organizationSlug || organizationName || branding
        ? {
            id: organizationId,
            slug: organizationSlug,
            name: organizationName,
            branding,
          }
        : null,
    branding,
  };
}

function buildWidgetBrandingBootstrap(widgetKey, getOrganizationBranding) {
  const context = normalizeBrandingContext(
    typeof getOrganizationBranding === "function"
      ? getOrganizationBranding()
      : null,
  );

  return {
    ...context,
    widgetKey: asString(widgetKey) || null,
    brandingRefreshPath: "/obs/widget-branding",
    brandingApiUrl: context.brandingApiUrl,
  };
}

function renderWidgetBrandingHead() {
  return '<link rel="stylesheet" href="/obs/static/widget-branding-bridge.css?v=widget-branding-v2" />';
}

function renderWidgetBrandingScripts(widgetKey, getOrganizationBranding) {
  return `<script>window.__ARENZYRA_LOCAL_WIDGET_BOOTSTRAP__ = ${safeJson(
    buildWidgetBrandingBootstrap(widgetKey, getOrganizationBranding),
  )};</script>\n    <script src="/obs/static/widget-branding-client.js?v=widget-branding-v2"></script>`;
}

module.exports = {
  buildWidgetBrandingBootstrap,
  normalizeBrandingContext,
  renderWidgetBrandingHead,
  renderWidgetBrandingScripts,
};
