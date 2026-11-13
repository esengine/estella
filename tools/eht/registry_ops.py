"""The Registry's entity operations, declared once.

Every backend reaches the C++ Registry's entity-level surface (create, destroy,
valid, activity, hierarchy) through a binding, and each binding used to be
written by hand: an embind ``.function`` here, an ``es_*`` global in the native
host, a TS signature, and a name in the SDK's native bridge. Four spellings of
one list, and only the web one was complete — the native host never bound
``valid``, which nothing noticed until a reader called it (issue #114).

This table is the list. The embind generator emits it as Registry methods, the
native generator as ``es_registry_<name>`` globals, the TS generator as the
``Registry`` interface and as ``REGISTRY_OPS`` (method -> native global), which
the SDK's native registry installs in a loop. A new op is one row here.

Per-component methods (has/get/add/remove<Name>) are not here: they come from
the component reflection. Nor are the hierarchy READS (hasParent, getChildren):
embind answers those through the Parent/Children component methods, so only the
native bridge needs them as entity ops.
"""

from dataclasses import dataclass
from typing import Tuple

# Argument and result kinds that cross. 'entity' is the raw u32 id.
_TS = {'entity': 'Entity', 'bool': 'boolean', 'number': 'number', 'void': 'void'}


@dataclass(frozen=True)
class RegistryOp:
    name: str
    params: Tuple[Tuple[str, str], ...]
    returns: str
    # C++ expression over `r` (the Registry) and `{0}`, `{1}`… (the arguments,
    # already converted to their C++ types by whichever backend emits it).
    call: str
    doc: str

    @property
    def native_name(self) -> str:
        return f'es_registry_{self.name}'

    def ts_signature(self) -> str:
        args = ', '.join(f'{n}: {_TS[k]}' for n, k in self.params)
        return f'{self.name}({args}): {_TS[self.returns]};'


def _e(name: str = 'entity') -> Tuple[str, str]:
    return (name, 'entity')


REGISTRY_OPS: Tuple[RegistryOp, ...] = (
    RegistryOp('create', (), 'entity', 'r.create()', 'A new entity.'),
    RegistryOp('destroy', (_e(),), 'void', 'r.destroy({0})', 'Destroys the entity and its components.'),
    RegistryOp('valid', (_e(),), 'bool', 'r.valid({0})', 'Whether the id names a live entity.'),
    RegistryOp('entityCount', (), 'number', 'r.entityCount()', 'Live entities.'),
    RegistryOp('reserveDestruction', (_e(),), 'bool', 'r.reserveDestruction({0})',
               'Claims the subtree teardown; false when another owner already has it.'),
    RegistryOp('releaseDestruction', (_e(),), 'void', 'r.releaseDestruction({0})',
               'Gives back a claim from reserveDestruction.'),
    RegistryOp('destructionPending', (_e(),), 'bool', 'r.destructionPending({0})',
               'Whether a teardown has claimed the entity.'),
    RegistryOp('setEntityEnabled', (_e(), ('enabled', 'bool')), 'bool', 'r.setEntityEnabled({0}, {1})',
               "Sets the entity's own enabled flag; activity follows the hierarchy."),
    RegistryOp('isEntityActive', (_e(),), 'bool', 'r.isEntityActive({0})',
               'Enabled itself and under enabled ancestors.'),
    RegistryOp('isEntityEnabled', (_e(),), 'bool', 'r.isEntityEnabled({0})',
               "The entity's own flag, ignoring ancestors."),
    RegistryOp('hasInactiveEntities', (), 'bool', 'r.hasInactiveEntities()',
               'Whether any entity is inactive (lets a query skip the activity check).'),
    RegistryOp('activityEpoch', (), 'number', 'r.activityEpoch()', 'Bumped by every activity change.'),
    RegistryOp('changeTick', (), 'number', 'r.changeTick()',
               'The tick a component write made now is stamped with.'),
    RegistryOp('beginChangeRead', (), 'number', 'r.beginChangeRead()',
               'For a reader about to look for changes: the tick it looks at; the clock then moves on.'),
    RegistryOp('setChangeAudit', (('enabled', 'bool'),), 'void', 'r.setChangeAudit({0})',
               'Turns on the audit that finds component writes made without a change stamp.'),
    RegistryOp('auditChanges', (), 'number', 'r.auditChanges()',
               'Unstamped component writes since the last audit (0 while the audit is off).'),
    RegistryOp('changeAuditTotal', (), 'number', 'r.changeAuditTotal()',
               'Unstamped component writes the audit has found since it was turned on.'),
    RegistryOp('setParent', (_e('child'), _e('parent')), 'bool',
               'esengine::ecs::setParent(r, {0}, {1})',
               'Re-parents child; false when refused (a cycle, an invalid entity).'),
)
