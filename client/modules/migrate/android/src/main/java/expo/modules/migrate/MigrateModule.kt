package expo.modules.migrate

import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.security.MessageDigest

/**
 * Read-only access to the Java app's data (same applicationId, so the same data
 * directory): the default SharedPreferences and the Room database "tv". Nothing
 * is ever written, migrated or deleted on the Java side. Also hosts small
 * Android utilities the app needs (ABI flavor, file SHA-256, parallel downloads).
 */
class MigrateModule : Module() {
  private val context: Context
    get() = requireNotNull(appContext.reactContext) { "React context is not available" }

  override fun definition() = ModuleDefinition {
    Name("Migrate")

    AsyncFunction("readLegacyPrefs") {
      // PreferenceManager.getDefaultSharedPreferences uses "<package>_preferences".
      val prefs = context.getSharedPreferences("${context.packageName}_preferences", Context.MODE_PRIVATE)
      prefs.all.mapNotNull { (key, value) -> typed(value)?.let { key to it } }.toMap()
    }

    AsyncFunction("readLegacyDb") {
      val file = context.getDatabasePath(DB_NAME)
      if (!file.exists()) return@AsyncFunction emptyDb()
      SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READONLY).use { db ->
        TABLES.associate { table -> table.lowercase() to readTable(db, table) }
      }
    }

    Function("getAbiFlavor") {
      val res = context.resources
      val id = res.getIdentifier("tvbox_abi_flavor", "string", context.packageName)
      if (id == 0) "" else res.getString(id)
    }

    Events("onDownloadProgress")

    // Downloads `url` to `path` (file:// URI or plain path) with up to `threads` range
    // connections; progress arrives as onDownloadProgress { id, bytes, total }.
    AsyncFunction("downloadFile") Coroutine { id: String, url: String, uri: String, threads: Int ->
      withContext(Dispatchers.IO) {
        val downloader = Downloader(id, url, File(filePath(uri)), threads) { bytes, total ->
          sendEvent("onDownloadProgress", mapOf("id" to id, "bytes" to bytes.toDouble(), "total" to total.toDouble()))
        }
        Downloader.start(downloader).toDouble()
      }
    }

    Function("cancelDownload") { id: String -> Downloader.cancel(id) }

    // Lowercase hex SHA-256 of a file:// URI or plain path, streamed in 64 KiB chunks.
    AsyncFunction("sha256File") { uri: String ->
      val path = filePath(uri)
      val digest = MessageDigest.getInstance("SHA-256")
      File(path).inputStream().use { input ->
        val buffer = ByteArray(64 * 1024)
        while (true) {
          val read = input.read(buffer)
          if (read < 0) break
          digest.update(buffer, 0, read)
        }
      }
      digest.digest().joinToString("") { "%02x".format(it) }
    }
  }

  private fun filePath(uri: String): String =
    if (uri.startsWith("file://")) requireNotNull(Uri.parse(uri).path) { "Invalid file URI" } else uri

  private fun typed(value: Any?): Map<String, Any>? = when (value) {
    is String -> mapOf("type" to "string", "value" to value)
    is Boolean -> mapOf("type" to "boolean", "value" to value)
    is Int -> mapOf("type" to "int", "value" to value)
    is Long -> mapOf("type" to "long", "value" to value.toDouble())
    is Float -> mapOf("type" to "float", "value" to value.toDouble())
    is Set<*> -> mapOf("type" to "set", "value" to value.filterIsInstance<String>())
    else -> null
  }

  private fun emptyDb(): Map<String, List<Map<String, Any?>>> = TABLES.associate { it.lowercase() to emptyList() }

  /** Every row of `table` as column -> value; empty when the table is missing. */
  private fun readTable(db: SQLiteDatabase, table: String): List<Map<String, Any?>> {
    val exists = db.rawQuery("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", arrayOf(table)).use { it.moveToFirst() }
    if (!exists) return emptyList()
    return db.rawQuery("SELECT * FROM `$table`", null).use { cursor ->
      val rows = ArrayList<Map<String, Any?>>(cursor.count)
      while (cursor.moveToNext()) {
        rows.add((0 until cursor.columnCount).associate { cursor.getColumnName(it) to column(cursor, it) })
      }
      rows
    }
  }

  private fun column(cursor: Cursor, index: Int): Any? = when (cursor.getType(index)) {
    Cursor.FIELD_TYPE_INTEGER -> cursor.getLong(index).toDouble()
    Cursor.FIELD_TYPE_FLOAT -> cursor.getDouble(index)
    Cursor.FIELD_TYPE_STRING -> cursor.getString(index)
    else -> null
  }

  companion object {
    /** AppDatabase.NAME */
    private const val DB_NAME = "tv"
    private val TABLES = listOf("Config", "History", "Keep")
  }
}
