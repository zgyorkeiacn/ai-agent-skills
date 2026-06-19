# Dependency Types Reference

Complete guide to connection patterns detected by the repo-dependency-analysis skill.

## Supported Connection Patterns

### 1. npm File Dependencies

**Pattern:** `"package-name": "file:../path/to/package"`

**Location:** `package.json` → `dependencies` or `devDependencies`

**Detection Logic:**
1. Parse package.json in each repository
2. Find entries where version starts with `file:`
3. Resolve relative path to absolute
4. Match absolute path against known repository paths
5. Create connection: consumer → provider

**Breaking Changes:**
- Renaming the package (`name` field in target package.json)
- Changing `bin` script paths or names
- Removing exported modules from `exports` field
- Changing `main` entry point
- Removing or renaming public TypeScript types

**Example:**
```json
{
  "dependencies": {
    "copilot-ado-figma-gherkin-agent": "file:../../../copilot-ado-figma-gherkin-agent"
  }
}
```

**Impact:** If provider changes bin scripts or exports, consumer's imports break.

---

### 2. Maven File Dependencies

**Pattern:** `<systemPath>../path/to/jar</systemPath>`

**Location:** `pom.xml` → `<dependency>` with `<scope>system</scope>`

**Detection Logic:**
1. Parse pom.xml XML
2. Find `<dependency>` blocks with `<scope>system</scope>`
3. Extract `<systemPath>` value
4. Resolve relative path
5. Create connection if path points to another tracked repository

**Breaking Changes:**
- Moving JAR file location
- Changing artifact version with incompatible API
- Removing public classes/methods
- Changing method signatures

**Example:**
```xml
<dependency>
  <groupId>com.example</groupId>
  <artifactId>shared-utils</artifactId>
  <version>1.0.0</version>
  <scope>system</scope>
  <systemPath>${project.basedir}/../shared-lib/target/utils.jar</systemPath>
</dependency>
```

---

### 3. Docker Service Dependencies

**Pattern:** `depends_on: [service-name]` or service references

**Location:** `docker-compose.yml`

**Detection Logic:**
1. Parse YAML structure
2. Extract all service names from top-level `services` block
3. Find `depends_on` declarations
4. Find network references
5. Map volume mounts that cross services
6. Create dependency graph

**Breaking Changes:**
- Renaming services
- Changing exposed ports
- Removing shared networks
- Changing volume mount paths
- Changing environment variable names passed between services

**Example:**
```yaml
services:
  agent:
    depends_on:
      - minerva
    networks:
      - sandbox-net
    environment:
      - API_URL=http://minerva:3001
```

**Impact:** Renaming `minerva` breaks `API_URL` reference and `depends_on`.

---

### 4. Environment Variables

**Pattern:** `VARIABLE_NAME=value`

**Location:** `.env.example`, `.env`, code files

**Detection Logic:**
1. Parse `.env.example` in each repository
2. Extract variable names (format: `^[A-Z_][A-Z0-9_]*=`)
3. Search code for `process.env.VARIABLE_NAME` (Node.js)
4. Search code for `System.getenv("VARIABLE_NAME")` (Java)
5. Cross-reference to find shared variables
6. Categorize as producer (defines in .env) vs consumer (uses in code)

**Breaking Changes:**
- Renaming variables
- Removing variables
- Changing expected format (e.g., URL → JSON)
- Changing default values that code relies on

**Example:**

Repository A (.env.example):
```env
GITHUB_TOKEN=your_token_here
AZURE_DEVOPS_PAT=your_pat_here
```

Repository B (code):
```typescript
const token = process.env.GITHUB_TOKEN;
const pat = process.env.AZURE_DEVOPS_PAT;
```

**Impact:** Renaming `GITHUB_TOKEN` in A breaks B's code.

---

### 5. API Schemas (OpenAPI/GraphQL)

**Pattern:** OpenAPI `paths`, GraphQL `schema`

**Location:** `openapi.json`, `openapi.yaml`, `schema.graphql`

**Detection Logic:**
1. Locate schema files by filename pattern
2. Parse schema format (OpenAPI 3.x, GraphQL SDL)
3. Extract endpoints/types
4. Compute fingerprint (hash of structure)
5. Find imports/references in other repositories
6. Track fingerprint changes over time

**Breaking Changes:**
- Removing endpoints
- Changing required fields
- Incompatible type changes (string → number)
- Changing response structure
- Removing or renaming operations

**Example:**

Service A (openapi.json):
```json
{
  "paths": {
    "/api/users": {
      "get": {
        "responses": {
          "200": {
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/User" }
              }
            }
          }
        }
      }
    }
  },
  "components": {
    "schemas": {
      "User": {
        "type": "object",
        "required": ["id", "username"],
        "properties": {
          "id": { "type": "string" },
          "username": { "type": "string" }
        }
      }
    }
  }
}
```

Service B (generated client):
```typescript
interface User {
  id: string;
  username: string;
}
```

**Impact:** Adding `email` as required field breaks B's client.

---

### 6. TypeScript Type Definitions

**Pattern:** `export interface`, `export type`, `import type`

**Location:** `.ts` files with exported types

**Detection Logic:**
1. Scan .ts files for `export interface` and `export type`
2. Build type export map per repository
3. Find cross-repo imports (import paths pointing outside repo)
4. Create type dependency graph
5. Track interface changes (added/removed properties)

**Breaking Changes:**
- Removing exported types
- Changing property types
- Making optional properties required
- Removing properties from interfaces
- Changing type parameters

**Example:**

Repository A (types/models.ts):
```typescript
export interface GenerateScenariosInput {
  azureStoryUrl: string;
  figmaFileOrFlowUrl?: string;  // Optional
  targetFramework: string;
}
```

Repository B (consumer.ts):
```typescript
import { GenerateScenariosInput } from 'shared-types';

const input: GenerateScenariosInput = {
  azureStoryUrl: 'https://...',
  targetFramework: 'playwright-bdd'
  // figmaFileOrFlowUrl omitted (optional)
};
```

**Impact:** Making `figmaFileOrFlowUrl` required breaks B's code.

---

## Custom Dependency Rules

For patterns not automatically detected, define custom rules in `.analysis-cache/custom-rules.json`:

```json
{
  "rules": [
    {
      "name": "Shared Configuration Schema",
      "sourceFile": "config/schema.json",
      "consumerRepos": ["service-a", "service-b"],
      "changeDetection": "hash",
      "breakingChangePatterns": [
        "required.*added",
        "type.*changed",
        "properties.*removed"
      ],
      "onBreakingChange": {
        "severity": "critical",
        "syncSteps": [
          "Update config files in consumer repos",
          "Validate config against new schema",
          "Run integration tests"
        ]
      }
    }
  ]
}
```

---

## Severity Levels

**CRITICAL:** Breaking changes that will cause immediate failures
- Removed endpoints
- Required field changes
- Type incompatibilities
- Missing dependencies

**WARNING:** Changes that may cause issues
- Renamed variables
- New optional fields
- Deprecated features
- Documentation changes

**INFO:** Non-breaking changes
- Internal refactoring
- Comment updates
- Test changes

---

## Detection Limitations

**Not Currently Detected:**
- Runtime-only dependencies (services discovered at runtime)
- Database schema dependencies
- Binary protocol dependencies
- Custom RPC frameworks
- Implicit contracts (behavioral expectations)

**Workaround:** Use custom rules to define these dependencies explicitly.

---

## Future Enhancements

Planned detection patterns:
- Protobuf message definitions
- gRPC service definitions
- Database migration scripts
- Shared CSS/styling frameworks
- Shared i18n translation files
- Binary API protocols
