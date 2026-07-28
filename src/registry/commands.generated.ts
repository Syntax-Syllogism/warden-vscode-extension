import type { CommandDef } from './types';

export const commands: readonly CommandDef[] = [
	{
		"id": "warden.provision",
		"cliId": "warden provision",
		"title": "SF Warden: Provision",
		"group": "User Lifecycle",
		"supportsNoPrompt": true,
		"flags": [
			{
				"name": "target-org",
				"kind": "org",
				"summary": "Target org username or alias.",
				"required": true
			},
			{
				"name": "users-def",
				"kind": "file",
				"summary": "Path to a user definition JSON or CSV file.",
				"required": true
			},
			{
				"name": "personas-def",
				"kind": "file",
				"summary": "Optional path to persona definition JSON file. Omit it for profile-only provisioning."
			},
			{
				"name": "external-id",
				"kind": "string",
				"summary": "Filterable User field used to match existing users by default. `--match-field` is an alias. Per-user `match` overrides this for individual rows. If omitted, all entries are treated as inserts. Multiple matches are skipped."
			},
			{
				"name": "fuzzy-username",
				"kind": "boolean",
				"summary": "Match Username values with optional Salesforce sandbox suffixes."
			},
			{
				"name": "dry-run",
				"kind": "boolean",
				"summary": "Validate and plan actions without any write operations."
			},
			{
				"name": "fail-on-insufficient-license",
				"kind": "boolean",
				"summary": "Fail after dry-run output when projected net-new users exceed user-license headroom."
			},
			{
				"name": "output-file",
				"kind": "outputFile",
				"summary": "Write the machine-readable output payload to this path.",
				"placeholder": "reports/warden-output.json"
			}
		]
	},
	{
		"id": "warden.access",
		"cliId": "warden access",
		"title": "SF Warden: Access",
		"group": "User Lifecycle",
		"flags": [
			{
				"name": "target-org",
				"kind": "org",
				"summary": "Target org username or alias.",
				"required": true
			},
			{
				"name": "type",
				"kind": "enum",
				"summary": "Target type to audit: field, object, apex-class, vf-page, custom-permission, or tab.",
				"required": true,
				"options": [
					"field",
					"object",
					"apex-class",
					"vf-page",
					"custom-permission",
					"tab"
				]
			},
			{
				"name": "target",
				"kind": "string",
				"summary": "Target API name. Use Object.Field for field, Object for object, Apex class name for apex-class, Visualforce page name for vf-page, custom permission DeveloperName for custom-permission, or tab API name for tab.",
				"placeholder": "Object__c.Field__c"
			},
			{
				"name": "user",
				"kind": "string",
				"summary": "Reverse audit for one user, using field:value matching.",
				"placeholder": "Username:myUser@email.com"
			},
			{
				"name": "sobject",
				"kind": "string",
				"summary": "Scope a reverse field/object audit to this SObject.",
				"placeholder": "Account"
			},
			{
				"name": "output-file",
				"kind": "outputFile",
				"summary": "Write the machine-readable output payload to this path.",
				"placeholder": "reports/warden-output.json"
			}
		]
	},
	{
		"id": "warden.strip",
		"cliId": "warden strip",
		"title": "SF Warden: Strip",
		"group": "User Lifecycle",
		"supportsNoPrompt": true,
		"destructive": true,
		"flags": [
			{
				"name": "user",
				"kind": "string",
				"summary": "Target a single user as field:value (e.g. Username:user@example.com).",
				"placeholder": "Username:myUser@email.com",
				"exclusiveGroup": "userTarget"
			},
			{
				"name": "users-def",
				"kind": "file",
				"summary": "Path to a user definition JSON or CSV file.",
				"exclusiveGroup": "userTarget"
			},
			{
				"name": "target-org",
				"kind": "org",
				"summary": "Target org username or alias.",
				"required": true
			},
			{
				"name": "external-id",
				"kind": "string",
				"summary": "Default field used to match users in the definition file.",
				"dependsOnFlag": "users-def"
			},
			{
				"name": "dry-run",
				"kind": "boolean",
				"summary": "Validate and plan actions without any write operations."
			},
			{
				"name": "no-freeze",
				"kind": "boolean",
				"summary": "Skip the initial freeze step."
			},
			{
				"name": "no-deactivate",
				"kind": "boolean",
				"summary": "Skip the final deactivation step."
			},
			{
				"name": "keep-permsets",
				"kind": "boolean",
				"summary": "Keep permission set assignments."
			},
			{
				"name": "keep-permset-groups",
				"kind": "boolean",
				"summary": "Keep permission set group assignments."
			},
			{
				"name": "keep-licenses",
				"kind": "boolean",
				"summary": "Keep permission set license assignments."
			},
			{
				"name": "keep-public-groups",
				"kind": "boolean",
				"summary": "Keep public group memberships."
			},
			{
				"name": "keep-queues",
				"kind": "boolean",
				"summary": "Keep queue memberships."
			},
			{
				"name": "snapshot",
				"kind": "string",
				"summary": "Write a portable user snapshot JSON file before stripping access, including during dry-run."
			},
			{
				"name": "output-file",
				"kind": "outputFile",
				"summary": "Write the machine-readable output payload to this path.",
				"placeholder": "reports/warden-output.json"
			}
		]
	},
	{
		"id": "warden.freeze",
		"cliId": "warden freeze",
		"title": "SF Warden: Freeze",
		"group": "User Lifecycle",
		"supportsNoPrompt": true,
		"flags": [
			{
				"name": "user",
				"kind": "string",
				"summary": "Target a single user as field:value (e.g. Username:user@example.com).",
				"placeholder": "Username:myUser@email.com",
				"exclusiveGroup": "userTarget"
			},
			{
				"name": "users-def",
				"kind": "file",
				"summary": "Path to a user definition JSON or CSV file.",
				"exclusiveGroup": "userTarget"
			},
			{
				"name": "target-org",
				"kind": "org",
				"summary": "Target org username or alias.",
				"required": true
			},
			{
				"name": "external-id",
				"kind": "string",
				"summary": "Default field used to match users in the definition file.",
				"dependsOnFlag": "users-def"
			},
			{
				"name": "dry-run",
				"kind": "boolean",
				"summary": "Validate and plan actions without any write operations."
			},
			{
				"name": "output-file",
				"kind": "outputFile",
				"summary": "Write the machine-readable output payload to this path.",
				"placeholder": "reports/warden-output.json"
			}
		]
	},
	{
		"id": "warden.unfreeze",
		"cliId": "warden unfreeze",
		"title": "SF Warden: Unfreeze",
		"group": "User Lifecycle",
		"supportsNoPrompt": true,
		"flags": [
			{
				"name": "user",
				"kind": "string",
				"summary": "Target a single user as field:value (e.g. Username:user@example.com).",
				"placeholder": "Username:myUser@email.com",
				"exclusiveGroup": "userTarget"
			},
			{
				"name": "users-def",
				"kind": "file",
				"summary": "Path to a user definition JSON or CSV file.",
				"exclusiveGroup": "userTarget"
			},
			{
				"name": "target-org",
				"kind": "org",
				"summary": "Target org username or alias.",
				"required": true
			},
			{
				"name": "external-id",
				"kind": "string",
				"summary": "Default field used to match users in the definition file.",
				"dependsOnFlag": "users-def"
			},
			{
				"name": "dry-run",
				"kind": "boolean",
				"summary": "Validate and plan actions without any write operations."
			},
			{
				"name": "output-file",
				"kind": "outputFile",
				"summary": "Write the machine-readable output payload to this path.",
				"placeholder": "reports/warden-output.json"
			}
		]
	},
	{
		"id": "warden.snapshot",
		"cliId": "warden snapshot",
		"title": "SF Warden: Snapshot",
		"group": "User Lifecycle",
		"flags": [
			{
				"name": "user",
				"kind": "string",
				"summary": "Target a single user as field:value (e.g. Username:user@example.com).",
				"placeholder": "Username:myUser@email.com",
				"exclusiveGroup": "userTarget"
			},
			{
				"name": "users-def",
				"kind": "file",
				"summary": "Path to a user definition JSON or CSV file.",
				"exclusiveGroup": "userTarget"
			},
			{
				"name": "target-org",
				"kind": "org",
				"summary": "Target org username or alias.",
				"required": true
			},
			{
				"name": "external-id",
				"kind": "string",
				"summary": "Default User field used to match entries in `--users-def`.",
				"dependsOnFlag": "users-def"
			},
			{
				"name": "output-file",
				"kind": "outputFile",
				"summary": "Write the machine-readable output payload to this path.",
				"placeholder": "reports/warden-output.json"
			}
		]
	},
	{
		"id": "warden.restore",
		"cliId": "warden restore",
		"title": "SF Warden: Restore",
		"group": "User Lifecycle",
		"flags": [
			{
				"name": "target-org",
				"kind": "org",
				"summary": "Target org username or alias.",
				"required": true
			},
			{
				"name": "snapshot",
				"kind": "file",
				"summary": "Snapshot JSON file to restore from.",
				"required": true
			},
			{
				"name": "no-prompt",
				"kind": "boolean",
				"summary": "Skip confirmation prompts before write operations."
			},
			{
				"name": "dry-run",
				"kind": "boolean",
				"summary": "Validate and plan actions without any write operations."
			},
			{
				"name": "output-file",
				"kind": "outputFile",
				"summary": "Write the machine-readable output payload to this path.",
				"placeholder": "reports/warden-output.json"
			}
		]
	},
	{
		"id": "warden.diff",
		"cliId": "warden diff",
		"title": "SF Warden: Diff",
		"group": "User Lifecycle",
		"flags": [
			{
				"name": "user",
				"kind": "string",
				"summary": "Target a single user as field:value (e.g. Username:user@example.com).",
				"placeholder": "Username:myUser@email.com",
				"exclusiveGroup": "userTarget"
			},
			{
				"name": "users-def",
				"kind": "file",
				"summary": "Path to a user definition JSON or CSV file.",
				"exclusiveGroup": "userTarget"
			},
			{
				"name": "target-org",
				"kind": "org",
				"summary": "Target org username or alias.",
				"required": true
			},
			{
				"name": "against",
				"kind": "string",
				"summary": "Compare against this baseline user or persona.",
				"required": true,
				"placeholder": "Username:otherUser@email.com",
				"dependsOnFlag": "user"
			},
			{
				"name": "personas-def",
				"kind": "file",
				"summary": "Optional path to persona definition JSON file. Omit it for profile-only diffing.",
				"dependsOnFlag": "users-def"
			},
			{
				"name": "external-id",
				"kind": "string",
				"summary": "Default User field used to match entries in `--users-def`.",
				"dependsOnFlag": "users-def"
			},
			{
				"name": "verbose",
				"kind": "boolean",
				"summary": "Include assignments that are already present in both sides in human output."
			},
			{
				"name": "verify",
				"kind": "boolean",
				"summary": "Check whether users conform to their intended definition."
			},
			{
				"name": "output-file",
				"kind": "outputFile",
				"summary": "Write the machine-readable output payload to this path.",
				"placeholder": "reports/warden-output.json"
			}
		]
	}
] as const;
