package com.fongmi.android.tv.server.api;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import com.fongmi.android.tv.setting.PlayerSetting;
import com.fongmi.android.tv.setting.Setting;
import com.github.catvod.utils.Prefers;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;

@RunWith(RobolectricTestRunner.class)
public class SettingRegistryTest {

    @Test
    public void unknownKeyIsReported() {
        assertFalse(SettingRegistry.set("no_such_setting", "1"));
    }

    @Test
    public void boolRoundTrips() {
        assertTrue(SettingRegistry.set("incognito", "true"));
        assertTrue(Setting.isIncognito());
        assertTrue(SettingRegistry.set("incognito", "false"));
        assertFalse(Setting.isIncognito());
    }

    @Test
    public void choiceStoresTheIndex() {
        assertTrue(SettingRegistry.set("scale", "2"));
        assertEquals(2, PlayerSetting.getScale());
    }

    @Test
    public void rejectsValuesOfTheWrongType() {
        assertThrows(IllegalArgumentException.class, () -> SettingRegistry.set("incognito", "yes"));
        assertThrows(IllegalArgumentException.class, () -> SettingRegistry.set("scale", "wide"));
        assertThrows(IllegalArgumentException.class, () -> SettingRegistry.set("buffer", "abc"));
    }

    @Test
    public void rejectsChoicesOutsideTheOptions() {
        assertThrows(IllegalArgumentException.class, () -> SettingRegistry.set("scale", "-1"));
        assertThrows(IllegalArgumentException.class, () -> SettingRegistry.set("dolby_vision", "99"));
    }

    @Test
    public void rejectsNumbersOutsideTheRange() {
        assertThrows(IllegalArgumentException.class, () -> SettingRegistry.set("buffer", "0"));
        assertThrows(IllegalArgumentException.class, () -> SettingRegistry.set("buffer", "11"));
        assertThrows(IllegalArgumentException.class, () -> SettingRegistry.set("buffer", "NaN"));
        assertTrue(SettingRegistry.set("buffer", "5"));
        assertEquals(5, PlayerSetting.getBuffer());
    }

    @Test
    public void backgroundPlaybackIsASwitch() {
        assertEquals("bool", find(SettingRegistry.toJson(), "background").get("type").getAsString());
        assertTrue(SettingRegistry.set("background", "false"));
        assertTrue(PlayerSetting.isBackgroundOff());
        assertTrue(SettingRegistry.set("background", "true"));
        assertTrue(PlayerSetting.isBackgroundOn());
    }

    @Test
    public void backgroundPictureInPictureFromThePhoneAppReadsAsOn() {
        Prefers.put("background", 2);
        assertTrue(PlayerSetting.isBackgroundOn());
        assertEquals(1, PlayerSetting.getBackground());
    }

    @Test
    public void hidesItemsThatDoNotApplyToTheCurrentEngine() {
        PlayerSetting.putEngine(PlayerSetting.ENGINE_EXO);
        assertTrue(has(SettingRegistry.toJson(), "buffer"));
        PlayerSetting.putEngine(PlayerSetting.ENGINE_MPV);
        assertFalse(has(SettingRegistry.toJson(), "buffer"));
    }

    @Test
    public void choicesCarryTheirOptions() {
        JsonObject scale = find(SettingRegistry.toJson(), "scale");
        assertEquals("enum", scale.get("type").getAsString());
        assertTrue(scale.getAsJsonArray("options").size() > 2);
    }

    private static boolean has(JsonArray groups, String key) {
        return find(groups, key) != null;
    }

    private static JsonObject find(JsonArray groups, String key) {
        for (JsonElement group : groups) {
            for (JsonElement item : group.getAsJsonObject().getAsJsonArray("items")) {
                if (key.equals(item.getAsJsonObject().get("key").getAsString())) return item.getAsJsonObject();
            }
        }
        return null;
    }
}
