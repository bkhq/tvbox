package com.fongmi.android.tv.ui.adapter;

import androidx.recyclerview.widget.RecyclerView;

/**
 * Precise RecyclerView notifications for adapters backed by a plain list. Unlike
 * notifyDataSetChanged() they keep view holders, so TV focus stays put; changed ranges carry a
 * payload so the item animator rebinds in place instead of cross-fading.
 */
public final class ListUpdate {

    public static final Object REFRESH = new Object();

    private ListUpdate() {
    }

    /** The whole list was replaced: {@code oldSize} items before, {@code newSize} after. */
    public static void replaced(RecyclerView.Adapter<?> adapter, int oldSize, int newSize) {
        int common = Math.min(oldSize, newSize);
        if (common > 0) adapter.notifyItemRangeChanged(0, common, REFRESH);
        if (oldSize > newSize) adapter.notifyItemRangeRemoved(newSize, oldSize - newSize);
        else if (newSize > oldSize) adapter.notifyItemRangeInserted(oldSize, newSize - oldSize);
    }

    /** Item state such as selection or focus targets changed, the items themselves did not. */
    public static void refresh(RecyclerView.Adapter<?> adapter) {
        if (adapter.getItemCount() > 0) adapter.notifyItemRangeChanged(0, adapter.getItemCount(), REFRESH);
    }
}
