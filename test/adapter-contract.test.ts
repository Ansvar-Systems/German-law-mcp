import assert from "node:assert/strict";
import test from "node:test";
import { BUILTIN_ADAPTERS } from "../src/adapters/index.js";

test("adapter capability flags match implemented handlers", () => {
  for (const adapter of BUILTIN_ADAPTERS) {
    if (adapter.capabilities.documents) {
      assert.equal(typeof adapter.searchDocuments, "function");
      assert.equal(typeof adapter.getDocument, "function");
    }

    if (adapter.capabilities.caseLaw) {
      assert.equal(typeof adapter.searchCaseLaw, "function");
    }

    if (adapter.capabilities.preparatoryWorks) {
      assert.equal(typeof adapter.getPreparatoryWorks, "function");
    }

    if (adapter.capabilities.citations) {
      assert.equal(typeof adapter.parseCitation, "function");
      assert.equal(typeof adapter.validateCitation, "function");
    }

    if (adapter.capabilities.formatting) {
      assert.equal(typeof adapter.formatCitation, "function");
    }

    if (adapter.capabilities.currency) {
      assert.equal(typeof adapter.checkCurrency, "function");
    }

    if (adapter.capabilities.legalStance) {
      assert.equal(typeof adapter.buildLegalStance, "function");
    }

    if (adapter.capabilities.eu) {
      assert.equal(typeof adapter.getEuBasis, "function");
      assert.equal(typeof adapter.searchEuImplementations, "function");
      assert.equal(typeof adapter.getNationalImplementations, "function");
      assert.equal(typeof adapter.getProvisionEuBasis, "function");
      assert.equal(typeof adapter.validateEuCompliance, "function");
    }

    if (adapter.capabilities.ingestion) {
      assert.equal(typeof adapter.runIngestion, "function");
    }
  }
});
