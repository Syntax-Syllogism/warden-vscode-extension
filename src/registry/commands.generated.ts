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
				"summary": "Path to user definition JSON file.",
				"required": true
			},
			{
				"name": "personas-def",
				"kind": "file",
				"summary": "Path to persona definition JSON file.",
				"required": true
			},
			{
				"name": "external-id",
				"kind": "string",
				"summary": "User field used to match existing users by default. Per-user `match` overrides this for individual rows. If omitted, all entries are treated as inserts."
			},
			{
				"name": "dry-run",
				"kind": "boolean",
				"summary": "Validate and plan actions without any write operations."
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
				"required": true,
				"placeholder": "Object__c.Field__c"
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
				"summary": "Path to a user definition JSON file.",
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
				"summary": "Path to a user definition JSON file.",
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
				"summary": "Path to a user definition JSON file.",
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
				"summary": "Path to a user definition JSON file.",
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
				"summary": "Path to user definition JSON file.",
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
				"summary": "Path to persona definition JSON file.",
				"required": true,
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
			}
		]
	}
] as const;
