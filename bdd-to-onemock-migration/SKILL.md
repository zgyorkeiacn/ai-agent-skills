---
name: bdd-to-onemock-migration
description: Migrate a Cucumber/REST-Assured BDD test suite that calls a live Vodafone DAL service to run against dx-onemock (WireMock-based local mock server). Produces onemock stub files, a test data YAML, Spring profile wiring, and a GitHub Actions pipeline. Pass the service name (e.g. "dal-care-dashboard") as the argument.
user-invocable: true
argument-hint: '<dal-service-name>  e.g. "dal-care-dashboard"'
---

# bdd-to-onemock-migration Skill

Migrates a Cucumber/REST-Assured BDD test suite from calling a live Vodafone DAL service to running entirely against a local `dx-onemock` instance. Works for any `dal-*` service that uses the standard Vodafone DAL authentication pattern (JWT access tokens, platform session IDs, HATEOAS responses).

All changes go on a feature branch following the convention `feature/<service>-bdd-onemock-integration` (e.g. `feature/dal-care-bdd-onemock-integration` for `dal-care-dashboard`) in both the BDD test repo and the `dx-onemock` repo.

---

## Prerequisites

Confirm these before starting:

- [ ] `dx-onemock` repo is at a known local path (ask the user if unknown)
- [ ] The BDD test repo has a `pom.xml` with `spring-boot-starter`, Cucumber, and REST Assured
- [ ] The service under test is a `dal-*` REST API using Bearer JWT auth and `platformSessionId` in the URL path
- [ ] `application.yml` in the test repo uses a `service.host` / `service.base-path` / `service.auth-host` property pattern

## Choosing the dx-onemock profile (READ FIRST)

dx-onemock has several profile folders under `src/test/resources/` (PaCE, BDD, Enterprise, FrodoBaggins, OnePortal). They are NOT interchangeable:

- **PaCE** (default profile) matches requests purely on URL/method/headers via WireMock + the `MockUserMatcher` extension. This is the right target for a plain Cucumber/REST-Assured suite that makes ordinary Bearer-token REST calls. It is also where existing `Dal*` care/dashboard/auth mocks live and what the `Dal*Tests` unit tests run against (the `build_server` test profile keeps the PaCE subfolder).
- **BDD** uses a stateful header-registry mechanism (`bdd-transformer-registry`): every mapping matches on `x-onemock-bdd-test-id` / `x-onemock-bdd-test-ttl` headers, and each test must *register* its mappings and send those headers on every request. This suits the checkout/device-list monorepo BDD framework, NOT a plain REST suite. Do not target it unless the suite already sends those headers.

**Default to PaCE** for a standard `dal-*` BDD suite. Confirm by checking which profile the existing `Dal*Tests` unit tests use (`@ActiveProfiles` on the abstract test base) and where existing mocks for the target service already live. Start dx-onemock for the suite with the default profile (`./run.sh -q` or `-Dspring.profiles.active=uk,disable_ems`), not `bdd`.

---

## Step 0 - Create feature branches

Use the naming convention `feature/<service>-bdd-onemock-integration`, where `<service>` is the short service name (e.g. `dal-care` for `dal-care-dashboard`). In both repos:
```
git checkout -b feature/<service>-bdd-onemock-integration
```

---

## Step 1 - Audit the BDD test repo

Read these files to collect the information needed for the rest of the skill:

1. `src/test/resources/application.yml` - identify the `service.host`, `service.port`, `auth.host` property names
2. `src/test/java/**/*StepDefinition*.java` and `*Steps.java` - list every unique HTTP endpoint called (method + path pattern)
3. `src/test/java/**/*LoginStep*.java` or equivalent - understand the current auth flow (pre-minted tokens vs live OAuth2)
4. `src/test/resources/testdata/*.yml` - count and name the test user aliases (paym, payg, hbb, etc.)
5. `src/test/resources/features/*.feature` - note which user aliases each feature uses

**Output:** produce an internal table:
- Column A: HTTP method + URL pattern (e.g. `GET /care-dashboard/{psid}/journey/{jt}/accounts/{id}`)
- Column B: user types required
- Column C: exists in onemock BDD profile? (check `dx-onemock/src/test/resources/BDD/mappings/` - read the folder)

---

## Step 2 - Define the account ID namespace

Assign a unique 9-digit base account ID to each test user type. Use the `700000NNN` range to avoid collisions with real VF account IDs. dx-onemock's `MockUser` system derives all other identifiers algorithmically:

| Derivation | Rule |
|---|---|
| `msisdn` | `447` + accountId (e.g. `447700000001`) |
| `msisdn07Format` | `07` + last 9 digits |
| `rootSubscription` | `4477000` + accountId |
| `ownerAccountIdHash` | base64 of accountId |

**Standard namespace** (extend as needed for the service):

| User alias | accountId | Notes |
|---|---|---|
| paym | 700000001 | Standard pay monthly |
| payg | 700000002 | Pay as you go |
| paygbvb | 700000003 | PAYG broadband voice bundle |
| mbb | 700000004 | Mobile broadband |
| bb | 700000005 | Broadband |
| hp | 700000006 | Hardware plan |
| hbb | 700000007 | Home broadband |
| one-number | 700000008 | One Number add-on |
| evo | 700000009 | EVO customer |
| evo-tour | 700000010 | EVO tour nudge user |
| collections | 700000011 | Airtime overdue / in collections |
| multi-billing | 700000012 | Multiple billing profiles |
| bingo-bar | 700000013 | Suspended notification user |
| inactive | 700000014 | Inactive / no active subscriptions |
| sub-user | 700000015 | Subscription sub-user |
| smb-owner | 700000016 | SMB account owner |
| smb-billpayer | 700000017 | SMB bill payer |
| smb-serviceuser | 700000018 | SMB service user |
| red-plus | 700000019 | RED Plus Leader |
| app-direct | 700000020 | App Direct |
| loyalty | 700000021 | VeryMe / loyalty offers user |

Add rows for any service-specific user types discovered in Step 1.

---

## Step 3 - Add stubs to dx-onemock (BDD profile)

For **each missing endpoint** from Step 1 Column C:

### 3a - Create the mapping file

Path: `dx-onemock/src/test/resources/BDD/mappings/DXL/<ServiceName>/json/<endpoint_name>.json`

Replace `<ServiceName>` with the PascalCase service name (e.g. `DalCareDashboard`).

**Template for a user-type-specific stub (higher priority):**
```json
{
  "id": "<generate-uuid>",
  "name": "<endpoint_name>_<usertype>",
  "priority": 10,
  "request": {
    "urlPattern": "/<service-path>/.*/journey/.*/<ACCOUNT_ID>/.*",
    "method": "GET"
  },
  "response": {
    "status": 200,
    "bodyFileName": "DXL/<ServiceName>/json/<endpoint_name>_<usertype>.json",
    "headers": {
      "Content-Type": "application/json;charset=UTF-8",
      "Matched-User-Id": "{{vfCustomParam.ownerAccountId}}",
      "Matched-trace-id": "{{vfCustomParam.correlationId}}"
    }
  },
  "uuid": "<same-uuid-as-id>",
  "metadata": { "mockedService": "<dal-service-name>" },
  "persistent": false
}
```

Replace `<ACCOUNT_ID>` with the literal account ID from the namespace (e.g. `700000001` for paym).

**Template for a generic catch-all stub (lower priority, uses MockUserMatcher):**
```json
{
  "id": "<generate-uuid>",
  "name": "<endpoint_name>",
  "priority": 100,
  "request": {
    "urlPattern": "/<service-path>/.*/journey/.*/.*/your-endpoint-path",
    "method": "GET",
    "customMatcher": {
      "name": "MockUserMatcher",
      "parameters": {
        "mappingName": "<endpoint_name>",
        "urlSegment": { "ownerAccountId": <N> }
      }
    }
  },
  "response": {
    "status": 200,
    "bodyFileName": "DXL/<ServiceName>/json/<endpoint_name>.json",
    "headers": {
      "Content-Type": "application/json;charset=UTF-8",
      "Matched-User-Id": "{{vfCustomParam.ownerAccountId}}"
    }
  },
  "uuid": "<same-uuid-as-id>",
  "metadata": { "mockedService": "<dal-service-name>" },
  "persistent": false
}
```

`urlSegment.ownerAccountId` value is the 0-based index of the accountId segment in the URL path. Count from the first `/` after the host.

**For PUT endpoints**, add a `"bodyPatterns"` matcher if the test validates request body content:
```json
"request": {
  "urlPattern": "...",
  "method": "PUT",
  "bodyPatterns": [{ "matchesJsonPath": "$.someField" }]
}
```

### 3b - Create the response body file

Path: `dx-onemock/src/test/resources/BDD/__files/DXL/<ServiceName>/json/<endpoint_name>.json`

Use `{{vfCustomParam.*}}` Handlebars variables for dynamic values. Available variables:

| Variable | Value |
|---|---|
| `{{vfCustomParam.ownerAccountId}}` | Account ID from URL/header |
| `{{vfCustomParam.msisdn}}` | Full MSISDN (447XXXXXXXXX) |
| `{{vfCustomParam.msisdn07Format}}` | MSISDN in 07XXXXXXXXX format |
| `{{vfCustomParam.rootSubscription}}` | Root subscription ID |
| `{{vfCustomParam.billingProfile}}` | Billing profile ID |
| `{{vfCustomParam.contactId}}` | Contact/CRM ID |
| `{{vfCustomParam.ownerAccountIdHash}}` | Base64 hash of accountId |
| `{{vfCustomParam.l2JwtTokenSessionId}}` | Platform session ID from JWT |
| `{{vfCustomParam.correlationId}}` | Request correlation ID |
| `{{vfCustomParam.nowDateValue}}` | Current HTTP-format date |

**HATEOAS link pattern** - always use session ID and account ID variables in `_links.href` values:
```json
"_links": {
  "get-subscriptions-list": {
    "href": "/<service-context>/{{vfCustomParam.l2JwtTokenSessionId}}/journey/dashboard/accounts/{{vfCustomParam.ownerAccountId}}/subscriptions",
    "type": "GET"
  }
}
```

### 3c - Auth stubs (find the real login seam first)

Before mocking auth, read the test suite's `LoginStep` / `AuthorizationHelper` to learn exactly which endpoints the login path calls. There are usually two login paths:

1. **Pre-minted token path** (`Given the user is logged in with account '<alias>'`): reads a token from a YAML file, then calls a server endpoint to decrypt it. In many DAL suites `AuthorizationHelper.getDecryptedToken(token)` does NOT decrypt locally — it calls `GET /authorization/{token}/decryptJwt` and reads the claims (`platform_session_id`, `accountId`, `subscriptionId`, `billingProfileId`, `given_name`, `username`) from the JSON response. **This single endpoint is all you need to mock for the pre-minted path.**
2. **Live OAuth2 path** (`Given the user is logged onto the dashboard with username ... account id ... subscriptionId ...`): a multi-step chain (anonymous token → login token → accounts → subscriptions → access token). Only mock this if scenarios you need use it.

**Recommended minimal auth mock — `decryptJwt`** (matches the synthetic token = account id, reflects claims back):

`mappings/DXL/DalAuthorization/AuthorizationDecryptJwt/json/authorization_decrypt_jwt.json`:
```json
{
  "id": "<uuid>", "name": "authorization_decrypt_jwt", "priority": 1,
  "request": {
    "urlPattern": "/authorization/.*/decryptJwt", "method": "GET",
    "customMatcher": { "name": "MockUserMatcher",
      "parameters": { "mappingName": "authorization_decrypt_jwt", "urlSegment": { "ownerAccountId": 2 } } }
  },
  "response": { "status": 200,
    "bodyFileName": "DXL/DalAuthorization/AuthorizationDecryptJwt/json/authorization_decrypt_jwt.json",
    "headers": { "Content-Type": "application/json;charset=UTF-8" } },
  "uuid": "<uuid>", "persistent": false
}
```
Body (`__files/.../authorization_decrypt_jwt.json`):
```json
{
  "platform_session_id": "psid-{{vfCustomParam.ownerAccountId}}",
  "accountId": "{{vfCustomParam.ownerAccountId}}",
  "subscriptionId": "{{vfCustomParam.msisdn}}",
  "billingProfileId": "bp-{{vfCustomParam.ownerAccountId}}",
  "given_name": "Test",
  "username": "USER{{vfCustomParam.ownerAccountId}}"
}
```
The MockUser `msisdn` derivation is `447` + accountId, so set the test-data YAML `subscriptionId` to `447<accountId>` to match. The platform session id can be any non-empty value — care-dashboard mocks match the session segment with `.*`.

For the live OAuth2 path (only if needed) the existing PaCE `DalAuthorization` stubs cover `authorizationToken`, `accessToken`, and `accounts`.

### 3d - Add unit tests in dx-onemock

For each new stub, add a test method to:
`dx-onemock/src/test/java/com/vodafone/digital/performance/functional/dxl/Dal<ServiceName>Tests.java`

(Create the file if it doesn't exist, following the pattern of `DalCareDashboardTests.java`.)

```java
@Test
void <endpointName>() throws IOException {
    runTest(
        httpGetOptions()
            .url("/<service-context>/abc/journey/dashboard/accounts/700000001/your-endpoint")
            .expectedResponseMappingDetails("<mapping_name>", "<uuid>"));
}
```

For endpoints with user-type variants, add one test per variant using the namespace account IDs.

---

## Step 4 - Create the onemock test data YAML

**File:** `src/test/resources/testdata/onemock.yml` in the BDD test repo

```yaml
# Maps test user aliases to onemock account IDs.
# dx-onemock derives all other identifiers (msisdn, subscription IDs, etc.) algorithmically.
paym:
  accountId: "700000001"
  subscriptionId: "447700000001"
payg:
  accountId: "700000002"
  subscriptionId: "447700000002"
# add all user types relevant to this service
```

Also add to `src/test/resources/application.properties`:
```properties
testdata.onemock=testdata/onemock.yml
```

---

## Step 5 - Add onemock Spring profile to application.yml

Append to `src/test/resources/application.yml` in the BDD test repo:

```yaml
---
spring:
  config:
    activate:
      on-profile: onemock
service:
  host: ${ONEMOCK_HOST:localhost}
  port: ${ONEMOCK_PORT:8888}
  protocol: ${ONEMOCK_PROTOCOL:http}
auth:
  host: ${ONEMOCK_HOST:localhost}
  port: ${ONEMOCK_PORT:8888}
  protocol: ${ONEMOCK_PROTOCOL:http}
```

**Do not hardcode `localhost`.** The `${ENV_VAR:default}` syntax makes this work locally (defaults) and in CI (env vars set by the pipeline).

---

## Step 6 - Wire the LoginStep

In the `LoginStep` (or equivalent step that sets `accessToken`, `platformSessionId`, `accountId`), add an onemock-profile branch:

```java
@Autowired
private Environment springEnv;

private boolean isOnemockProfile() {
    return Arrays.asList(springEnv.getActiveProfiles()).contains("onemock");
}

// In the @Given login step:
if (isOnemockProfile()) {
    Map<String, String> userData = testDataReaderHelper.getOnemockUser(userAlias);
    String accountId = userData.get("accountId");
    String subscriptionId = userData.get("subscriptionId");

    // Call onemock auth to get a JWT (onemock generates a real HS256 token)
    Response authTokenResponse = given()
        .header("msisdn", "[" + subscriptionId + "]")
        .post(authBaseUrl + "/authorization/authorizationToken");
    String authToken = authTokenResponse.jsonPath().getString("authorizationToken");

    Response accessTokenResponse = given()
        .header("Authorization", "Bearer " + authToken)
        .post(authBaseUrl + "/authorization/accessToken");
    String accessToken = accessTokenResponse.jsonPath().getString("accessToken");

    // Decode the JWT to get platformSessionId (reuse AuthorizationHelper.decryptToken if it exists)
    String platformSessionId = extractPlatformSessionId(accessToken);

    BaseStepDefinition.accessToken = accessToken;
    BaseStepDefinition.platformSessionId = platformSessionId;
    BaseStepDefinition.accountId = accountId;
    BaseStepDefinition.subscriptionId = subscriptionId;
} else {
    // existing pre-minted token / live auth logic unchanged
}
```

**Guard the live OAuth2 flow** in `AuthorizationHelper` (if it makes calls to Jenkins IDM or real VF auth):
```java
public AuthorizationToken getToken(String user, String password) {
    if (isOnemockProfile()) {
        throw new IllegalStateException("Live auth not available in onemock profile - use LoginStep.isOnemockProfile() branch");
    }
    // existing flow
}
```

---

## Step 7 - Tag scenarios with @onemock

As each feature's scenarios are verified working against onemock, tag them:
```gherkin
@onemock @CB
Scenario: User views their subscription summary
```

Do not tag scenarios that require state only available in live environments (e.g. scenarios that verify real account mutations cannot be reverted). These remain live-only.

---

## Step 8 - Create the GitHub Actions pipeline

**File:** `.github/workflows/bdd-onemock.yml` in the BDD test repo root

```yaml
name: BDD Tests (onemock)
on:
  pull_request:
    branches: [main]
  push:
    branches: [feature/<service>-bdd-onemock-integration]   # e.g. feature/dal-care-bdd-onemock-integration

jobs:
  bdd-tests:
    runs-on: ubuntu-latest
    services:
      onemock:
        image: <REGISTRY>/vf-onemock:<TAG>   # replace with actual image ref
        ports:
          - 8888:8888
        options: >-
          --health-cmd "curl -sf http://localhost:8888/__admin/mappings"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 12

    env:
      ONEMOCK_HOST: localhost
      ONEMOCK_PORT: "8888"
      ONEMOCK_PROTOCOL: http

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          java-version: '21'
          distribution: 'temurin'
          cache: maven
      - name: Wait for onemock readiness
        run: curl --silent --retry 20 --retry-delay 3 --retry-connrefused http://localhost:8888/__admin/mappings > /dev/null
      - name: Run BDD tests against onemock
        run: mvn test -Dspring.profiles.active=onemock -Dcucumber.filter.tags="@onemock"
        working-directory: <test-module-directory>
```

> If no Docker image is published yet (common), build dx-onemock from source and start the JAR as a background process. dx-onemock is a separate repo, so check it out too, and note it needs **Java 17** while the test suite may need a different JDK (e.g. 21) — use two `setup-java` steps. Start it with the **default (PaCE) profile**, not `bdd`:
> ```yaml
> - uses: actions/checkout@v4
>   with: { repository: <org>/dx-onemock, ref: master, token: ${{ secrets.ONEMOCK_REPO_TOKEN }}, path: dx-onemock }
> - uses: actions/setup-java@v4
>   with: { java-version: '17', distribution: 'temurin', cache: maven }
> - name: Build & start onemock
>   working-directory: dx-onemock
>   env:
>     til_server_cert_truststore_file: "file:src/main/resources/cacerts.til_dev"
>     wireMock_flag_emsEnabled: "False"
>     wireMock_httpPort: "8888"
>   run: |
>     mvn -B -q package -DskipTests
>     JAR=$(ls target/onemock-*.jar | grep -v spring-boot | head -n1)
>     nohup java -jar -Dspring.profiles.active=uk,disable_ems "$JAR" > onemock.log 2>&1 &
>     for i in $(seq 1 60); do curl -sf http://localhost:8888/__admin/mappings -o /dev/null && exit 0; sleep 3; done
>     tail -n 100 onemock.log; exit 1
> # then a second setup-java for the test suite's JDK, then run the tests
> ```
> Both Maven builds pull internal Vodafone artifacts from the Azure DevOps "Digital" feed, so write `~/.m2/settings.xml` from `AZURE_DEVOPS_USERNAME` / `AZURE_DEVOPS_API_KEY` secrets before building.

---

## Step 9 - Verify end-to-end

Run in this order, fixing issues before proceeding to the next step:

1. **dx-onemock unit tests pass** (add a test per new stub in `Dal<Service>Tests.java`, then run just that class; needs the Azure feed online for the first build):
   ```
   cd dx-onemock && ./mvnw test -Dtest=Dal<Service>Tests -Dsurefire.failIfNoSpecifiedTests=false
   ```
   `runTest(...).expectedResponseMappingDetails(name, uuid)` asserts the exact stub that served the request, so this catches priority/pattern shadowing.

2. **Start onemock and confirm stubs load** (default/PaCE profile):
   ```
   curl -s http://localhost:8888/__admin/mappings | jq '.mappings | length'   # non-zero
   ```

3. **decryptJwt returns the reflected claims:**
   ```
   curl -s "http://localhost:8888/authorization/700000001/decryptJwt"
   # expect accountId=700000001, subscriptionId=447700000001, non-empty platform_session_id
   ```

4. **Care-dashboard endpoints match the right stub** (check the `Matched-Stub-Name` header, not just status):
   ```
   curl -s -D - "http://localhost:8888/care-dashboard/psid-1/journey/dashboard/accounts/700000002/subscriptions/subscription" | grep -Ei "Matched-Stub-Name|productType"
   # expect subscription_summary_payg / "productType": "PAYG"
   ```

5. **Simplest BDD scenario, then the full tagged suite** (needs the test repo's JDK + Azure feed):
   ```
   mvn test -Dspring.profiles.active=onemock -Dcucumber.filter.tags="@health-check or @onemock"
   ```

6. **HATEOAS chain scenarios** (e.g. `dashboard-journey`, `plans-journey`) - confirm the `_links.href` values contain the dynamic session id (`{{request.path.[1]}}`) and account id so `stored{...}` assertions resolve.

7. **GitHub Actions** - push the feature branch and confirm the pipeline is green.

---

## Patterns and pitfalls

### Two different segment-indexing schemes (VERIFIED — easy to get wrong)
`MockUserMatcher`'s `urlSegment` and WireMock's `{{request.path.[N]}}` index differently:

- **`MockUserMatcher` `urlSegment` COUNTS the leading empty segment** (from the leading `/`) as index 0:
  ```
  /care-dashboard/SESSION_ID/journey/dashboard/accounts/ACCOUNT_ID/subscriptions
  ""  care-dashboard  SESSION  journey  dashboard  accounts  ACCOUNT_ID  subscriptions
  0        1             2        3        4          5          6            7
  ```
  So `ownerAccountId` is at index **6** → `"urlSegment": { "ownerAccountId": 6 }`.
- **`{{request.path.[N]}}` does NOT count the leading empty segment** — index 0 is the first real segment (`care-dashboard`), so the session id is `{{request.path.[1]}}` and the account id is `{{request.path.[5]}}`.

Always confirm indices empirically (start onemock, curl the endpoint, inspect the rendered `_links` hrefs) rather than trusting a count.

### Priority ordering (VERIFIED — existing greedy stubs can shadow yours)
WireMock matches by priority, **lowest number = highest priority**. A stub with **no `priority` field beats a stub with an explicit high number** (unset priority is treated as very high priority). Existing mocks often use greedy patterns like `.../subscriptions.*` (trailing `.*`) with no priority, which then capture more specific URLs such as `.../subscriptions/subscription`. To win, give your specific mocks `"priority": 1` (per-user-type variants) and `"priority": 2` (generic catch-all) — small numbers that beat the unset default. Verify with the `Matched-Stub-Name` response header which stub actually served the request.

### PUT endpoints are stateless in onemock
onemock returns a fixed response for PUT calls - no state is actually mutated. If a scenario does a GET after a PUT and asserts the mutated value, either:
- Mock a separate GET stub that returns the post-mutation state for that specific accountId
- Or leave the scenario un-tagged (`@onemock`) and keep it as a live-only test

### HATEOAS link hrefs must reflect the request, not hardcode
Hardcoded session/account IDs in `_links.href` cause `stored{platformSessionId}` / `stored{accountId}` assertions to fail. Reflect them from the request URL with `{{request.path.[1]}}` (session) and `{{request.path.[5]}}` (account), or use `{{vfCustomParam.ownerAccountId}}` for the account when `MockUserMatcher` is present. (`{{vfCustomParam.l2JwtTokenSessionId}}` only works when the session is embedded in a JWT `Authorization` header, not for these plain path-based calls.)

### Tag scenarios only after verifying the mock satisfies ALL their assertions
A scenario's `And Verify following fields` block asserts specific values (product types, exact ids, nested links). Only add `@onemock` once the mock response satisfies every assertion. Scenarios with rich field tables (exact `subscriptionId`, deep `subscriptionLinks`/`analyticsEvent` structures) need correspondingly rich mock bodies — tag them only after they actually pass in a real run.

### Pre-minted JWT tokens are not reused
The existing `T1E4.yml` / `T3E1.yml` / `T4E7.yml` tokens are signed against real VF keys. Under the onemock profile the suite uses synthetic tokens (= account ids) and the mocked `decryptJwt` endpoint instead. Do not attempt to reuse the environment-signed tokens against onemock.

### Handlebars and `MockUserMatcher` are complementary
`MockUserMatcher` extracts the user identifier from the request and populates `vfCustomParam.*` values. Handlebars then substitutes those values into the response body template. Both are required for dynamic responses.
