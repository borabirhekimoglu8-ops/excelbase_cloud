import GRDB

extension AppDatabase {
    static var migrator: DatabaseMigrator {
        var migrator = DatabaseMigrator()
        migrator.registerMigration("v1_offline_foundation") { db in
            try db.create(table: "passenger_records") { table in
                table.column("id", .text).primaryKey()
                table.column("ciphertext", .blob).notNull()
                table.column("identityKey", .text).notNull().indexed()
                table.column("sortOrder", .integer).notNull().defaults(to: 0).indexed()
                table.column("sourceJobID", .text)
                table.column("createdAt", .double).notNull()
                table.column("updatedAt", .double).notNull().indexed()
            }

            try db.create(table: "import_batches") { table in
                table.column("id", .text).primaryKey()
                table.column("replaceRequested", .boolean).notNull().defaults(to: false)
                table.column("replaceConsumed", .boolean).notNull().defaults(to: false)
                table.column("duplicateStrategy", .text).notNull().defaults(to: DuplicateStrategy.skip.rawValue)
                table.column("createdAt", .double).notNull().indexed()
            }

            try db.create(table: "import_jobs") { table in
                table.column("id", .text).primaryKey()
                table.column("batchID", .text).notNull()
                    .references("import_batches", onDelete: .cascade)
                    .indexed()
                table.column("fileName", .text).notNull()
                table.column("status", .text).notNull().indexed()
                table.column("totalRows", .integer).notNull().defaults(to: 0)
                table.column("processedRows", .integer).notNull().defaults(to: 0)
                table.column("message", .text)
                table.column("stagedPath", .text).notNull()
                table.column("sha256", .text).notNull()
                table.column("checkpointRow", .integer).notNull().defaults(to: 0)
                table.column("outputPath", .text)
                table.column("createdAt", .double).notNull().indexed()
                table.column("updatedAt", .double).notNull()
            }

            try db.create(table: "import_staging_rows") { table in
                table.column("jobID", .text).notNull()
                    .references("import_jobs", onDelete: .cascade)
                table.column("rowNumber", .integer).notNull()
                table.column("passengerID", .text).notNull()
                table.column("ciphertext", .blob).notNull()
                table.column("identityKey", .text).notNull()
                table.column("sortOrder", .integer).notNull().defaults(to: 0)
                table.column("createdAt", .double).notNull()
                table.primaryKey(["jobID", "rowNumber"])
                table.uniqueKey(["jobID", "passengerID"])
            }

            try db.create(table: "passenger_photos") { table in
                table.column("id", .text).primaryKey()
                table.column("passengerID", .text)
                    .references("passenger_records", onDelete: .setNull)
                    .indexed()
                table.column("originalFileName", .text).notNull()
                table.column("relativePath", .text).notNull().unique()
                table.column("sha256", .text).notNull().indexed()
                table.column("matchConfidence", .double)
                table.column("createdAt", .double).notNull().indexed()
            }

            try db.create(table: "archives") { table in
                table.column("id", .text).primaryKey()
                table.column("name", .text).notNull()
                table.column("relativePath", .text).notNull().unique()
                table.column("passengerCount", .integer).notNull()
                table.column("createdAt", .double).notNull().indexed()
            }
        }
        return migrator
    }
}
