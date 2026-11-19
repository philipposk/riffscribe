#!/usr/bin/env node
/**
 * Checks the operator-identity gate: live billing stays closed until the legal
 * name, CVR number and address are all filled in; test mode is never blocked.
 *
 * Run with: node --experimental-strip-types scripts/verify-company.mjs
 */
let co;
try {
  co = await import("../src/lib/company.ts");
} catch (e) {
  if (e?.code === "ERR_UNKNOWN_FILE_EXTENSION") {
    console.log("run with: node --experimental-strip-types scripts/verify-company.mjs");
    process.exit(1);
  }
  throw e;
}

let failed = 0;
const check = (name, ok) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failed++;
};

const { COMPANY, companyComplete, companyLine, operatorBlocksBilling } = co;
const saved = { ...COMPANY };
const set = (v) => Object.assign(COMPANY, saved, v);

set({ legalName: null, cvr: null, address: null });
check("blank identity is incomplete", !companyComplete() && companyLine() === null);
check("blank identity blocks live billing", operatorBlocksBilling(true));
check("blank identity leaves test mode open", !operatorBlocksBilling(false));

for (const missing of ["legalName", "cvr", "address"]) {
  set({ legalName: "Example ApS", cvr: "12345678", address: "Street 1, 1000 Kbh", [missing]: null });
  check(`missing ${missing} blocks live billing`, operatorBlocksBilling(true));
}

set({ legalName: "Example ApS", cvr: "12345678", address: "Street 1, 1000 Kbh" });
check("full identity is complete", companyComplete());
check("full identity opens live billing", !operatorBlocksBilling(true));
check("identity line names the operator", (companyLine() ?? "").includes("Example ApS · CVR 12345678"));

set({});
if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
