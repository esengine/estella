"""Native buffers must be compiler-validated; owned fields use member bindings."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from eht.data import Component, Property
from eht.generators.native_bindings import NativeBindingsGenerator


class NativeLayoutTests(unittest.TestCase):
    def generate(self, properties):
        return NativeBindingsGenerator([
            Component('Fixture', 'esengine::ecs', properties)
        ], []).generate()

    def test_buffer_requires_actual_offsets_and_trivial_ownership(self):
        code = self.generate([Property('text', 'std::string'), Property('speed', 'f32')])
        self.assertIn('std::is_trivially_copyable_v<esengine::ecs::Fixture>', code)
        self.assertIn('std::is_standard_layout_v<esengine::ecs::Fixture>', code)
        self.assertIn('offsetof(esengine::ecs::Fixture, speed) == 12', code)
        self.assertIn('c.text.assign(s.c_str(), s.size())', code)
        self.assertIn('esjs::string(std::string_view(c->text.data(), c->text.size()))', code)
        self.assertIn('es_get_Fixture', code)
        # Engine-neutral: the generated TU names no engine API.
        self.assertNotIn('JS_', code)
        self.assertNotIn('JSContext', code)

    def test_vector_following_scalar_is_guarded_and_members_use_names(self):
        code = self.generate([Property('path', 'std::vector<glm::vec2>'),
                              Property('enabled', 'bool'), Property('rotation', 'glm::quat')])
        self.assertIn('offsetof(esengine::ecs::Fixture, enabled) == 12', code)
        self.assertIn('es_Fixture_path_set', code)
        self.assertIn('c.rotation.w', code)
        self.assertIn('esjs::isArray(v) ? "3" : "w"', code)

    def test_member_path_respects_readonly_and_shared_transform_write_hook(self):
        code = NativeBindingsGenerator([Component('Transform', 'esengine::ecs', [
            Property('position', 'glm::vec3'),
            Property('worldPosition', 'glm::vec3', annotations={'readonly': ''}),
        ])], []).generate()
        self.assertIn('c.position.x =', code)
        self.assertNotIn('c.worldPosition.x =', code)
        self.assertIn('c->worldPosition.x', code)
        self.assertIn('esengine::ecs::invalidateTransformComposition();', code)


if __name__ == '__main__':
    unittest.main()
