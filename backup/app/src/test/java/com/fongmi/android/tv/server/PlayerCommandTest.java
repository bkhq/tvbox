package com.fongmi.android.tv.server;

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;

import org.junit.Test;

public class PlayerCommandTest {

    @Test
    public void knowsTheRemoteAndLegacyCommands() {
        for (String type : new String[]{"play", "pause", "toggle", "stop", "prev", "next", "repeat", "replay"}) {
            assertNotNull(type, PlayerCommand.of(type, ""));
        }
        assertNotNull(PlayerCommand.of("seek", "-10000"));
        assertNotNull(PlayerCommand.of("seekto", "60000"));
        assertNotNull(PlayerCommand.of("speed", "1.5"));
    }

    @Test
    public void unknownCommandIsNull() {
        assertNull(PlayerCommand.of("rewind", ""));
        assertNull(PlayerCommand.of("", ""));
    }

    @Test
    public void badValuesFailBeforeReachingThePlayer() {
        assertThrows(IllegalArgumentException.class, () -> PlayerCommand.of("seek", "abc"));
        assertThrows(IllegalArgumentException.class, () -> PlayerCommand.of("seek", ""));
        assertThrows(IllegalArgumentException.class, () -> PlayerCommand.of("seekto", "1.5"));
        assertThrows(IllegalArgumentException.class, () -> PlayerCommand.of("speed", "fast"));
        assertThrows(IllegalArgumentException.class, () -> PlayerCommand.of("speed", "0"));
        assertThrows(IllegalArgumentException.class, () -> PlayerCommand.of("speed", "NaN"));
        assertThrows(IllegalArgumentException.class, () -> PlayerCommand.of("speed", "100"));
    }
}
