import unittest

from generate_text_video import MAX_SCENE_WORDS, SCENE_COUNT, create_storyboard


class StoryboardTests(unittest.TestCase):
    def test_storyboard_has_six_scenes_with_bounded_narration(self):
        text = " ".join(
            f"Sentence {index} explains a different important idea about our world."
            for index in range(1, 15)
        )

        scenes = create_storyboard(text)

        self.assertEqual(len(scenes), SCENE_COUNT)
        self.assertTrue(all(0 < len(scene.split()) <= MAX_SCENE_WORDS for scene in scenes))

    def test_hindi_story_is_split_across_scenes_without_losing_its_topic(self):
        text = (
            "यह एक छोटी कहानी है। एक जिज्ञासु बच्चा जंगल में जाता है। "
            "वह नदी और पेड़ों को बचाने का तरीका सीखता है। "
            "पूरा गांव मिलकर प्रकृति की रक्षा करता है।"
        )
        scenes = create_storyboard(text)

        self.assertEqual(len(scenes), SCENE_COUNT)
        combined = " ".join(scenes)
        self.assertIn("जंगल", combined)
        self.assertIn("नदी", combined)

    def test_medium_text_is_split_across_scenes_instead_of_repeated(self):
        text = (
            "A curious explorer finds a hidden forest and meets kind neighbors. "
            "Together they protect the river, plant new trees, and help their "
            "community thrive through every season."
        )

        scenes = create_storyboard(text)

        self.assertEqual(len(scenes), SCENE_COUNT)
        self.assertEqual(len(set(scenes)), SCENE_COUNT)


if __name__ == "__main__":
    unittest.main()
