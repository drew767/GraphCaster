# Copyright GraphCaster. All Rights Reserved.

"""Webhook notification template registry (F89)."""

from graph_caster.notifications.templates import (
    TEMPLATES,
    DiscordTemplate,
    GenericTemplate,
    SlackTemplate,
    TeamsTemplate,
    WebhookTemplate,
    get_template,
)

__all__ = [
    "TEMPLATES",
    "DiscordTemplate",
    "GenericTemplate",
    "SlackTemplate",
    "TeamsTemplate",
    "WebhookTemplate",
    "get_template",
]
