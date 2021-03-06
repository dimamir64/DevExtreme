"use strict";

var $ = require("jquery"),
    logger = require("core/utils/console").logger,
    DataSource = require("data/data_source/data_source").DataSource,
    ArrayStore = require("data/array_store"),
    CustomStore = require("data/custom_store"),
    ODataStore = require("data/odata/store"),
    dataQuery = require("data/query"),
    gridCore = require("ui/data_grid/ui.data_grid.core"),
    dataGridMocks = require("../../helpers/dataGridMocks.js"),
    setupDataGridModules = dataGridMocks.setupDataGridModules,
    loadTotalCount = require("ui/data_grid/ui.data_grid.grouping.expanded").loadTotalCount,
    createOffsetFilter = require("ui/data_grid/ui.data_grid.grouping.core").createOffsetFilter,
    getContinuationGroupCount = require("ui/data_grid/ui.data_grid.grouping.collapsed").getContinuationGroupCount,
    ExpandedGroupingHelper = require("ui/data_grid/ui.data_grid.grouping.expanded").GroupingHelper,
    CollapsedGroupingHelper = require("ui/data_grid/ui.data_grid.grouping.collapsed").GroupingHelper;

require("ui/data_grid/ui.data_grid");


var TEN_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

var createDataSource = function(options) {
    options._preferSync = true;
    var dataSource = new DataSource(options);

    var dataGridStub = {
        options: {
            scrolling: options.scrolling,
            cacheEnabled: options.cacheEnabled,
            remoteOperations: options.remoteOperations,
            loadingTimeout: options.loadingTimeout !== undefined ? options.loadingTimeout : (options.asyncLoadEnabled ? 0 : undefined)
        }
    };

    setupDataGridModules(dataGridStub, ['data', 'columns']);

    var dataSourceAdapter = dataGridStub.dataController._createDataSourceAdapter(dataSource);

    var origItems = dataSourceAdapter.items;
    var processItems = function(items) {
        for(var i = 0; i < items.length; i++) {
            if(typeof items[i] === "object") {
                if("items" in items[i] && items[i].items !== null) {
                    processItems(items[i].items);
                }
                if("collapsedItems" in items[i]) {
                    delete items[i]["collapsedItems"];
                }
                if("key" in items[i] && "items" in items[i] && "count" in items[i]) {
                    delete items[i]["count"];
                }
            }
        }
    };

    dataSourceAdapter.items = function() {
        var items = origItems.apply(this, arguments);

        processItems(items);

        return items;
    };

    return dataSourceAdapter;
};


QUnit.module("Grid DataSource", {
    beforeEach: function() {
        this.clock = sinon.useFakeTimers();
    },
    afterEach: function() {
        TEN_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        this.clock.restore();
    }
});

QUnit.test("page index parallel change", function(assert) {
    var loadingPages = [],
        source = createDataSource({
            store: {
                onLoading: function(options) {
                    loadingPages.push(source.pageIndex());
                },
                type: 'array',
                data: TEN_NUMBERS
            },
            pageSize: 3,
            asyncLoadEnabled: true,
            requireTotalCount: true,
            remoteOperations: { filtering: true, sorting: true, paging: true }
        }),
        changeCallCount = 0;

    source.load().done(function() {
        source.changed.add(function(options) {
            changeCallCount++;
        });

        source.pageIndex(1);
        source.load();

        source.pageIndex(2);
        source.load();

        source.pageIndex(3);
        source.load();
    });

    this.clock.tick();

    assert.equal(changeCallCount, 1);
    assert.equal(source.pageIndex(), 3);
    assert.equal(loadingPages.length, 2, 'one loading occurs');
    assert.deepEqual(loadingPages, [0, 3], 'last loading occurs');
    assert.ok(!source.isLoading(), 'loading completed');
});

QUnit.test("get page size if paginate enabled", function(assert) {
    var source = createDataSource({
            store: TEN_NUMBERS,
            pageSize: 3
        }),
        changeCallCount = 0;

    source.load().done(function() {
        changeCallCount++;
    });

    this.clock.tick();

    assert.equal(changeCallCount, 1);
    assert.equal(source.pageSize(), 3);
});

QUnit.test("get page size if paginate disabled", function(assert) {
    var source = createDataSource({
            store: TEN_NUMBERS,
            pageSize: 3,
            paginate: false
        }),
        changeCallCount = 0;

    source.load().done(function() {
        changeCallCount++;
    });

    this.clock.tick();

    assert.equal(changeCallCount, 1);
    assert.equal(source.pageSize(), 0);
});

QUnit.test("page size change", function(assert) {
    var source = createDataSource({
            store: TEN_NUMBERS,
            pageSize: 3
        }),
        changeCallCount = 0;

    source.load().done(function() {
        assert.equal(source.items().length, 3);
        source.pageSize(5);
        source.load().done(function() {
            changeCallCount++;
        });
    });

    this.clock.tick();

    assert.equal(changeCallCount, 1);
    assert.deepEqual(source.items(), [1, 2, 3, 4, 5]);
});

QUnit.test("reload do not reset pageIndex", function(assert) {
    var source = createDataSource({
        store: TEN_NUMBERS,
        pageSize: 3
    });

    source.load();
    source.pageIndex(1);

    //act
    source.reload();

    //assert
    assert.equal(source.pageIndex(), 1);
    assert.equal(source.items().length, 3);
    assert.equal(source.items()[0], 4);
});

QUnit.test("reload full reset isLoaded", function(assert) {
    var source = createDataSource({
            store: TEN_NUMBERS,
            pageSize: 3,
            asyncLoadEnabled: true
        }),
        finalized;

    source.load().done(function() {
        assert.ok(source.isLoaded());
        //act
        source.reload(true);
        //assert
        assert.ok(!source.isLoaded());

        finalized = true;
    });

    this.clock.tick();
    assert.ok(finalized);
});


QUnit.test("reload calls before last load complete", function(assert) {
    var totalCountDeferred = $.Deferred(),
        source = createDataSource({
            store: new CustomStore({
                load: function() {
                    return TEN_NUMBERS;
                },
                totalCount: function() {
                    return totalCountDeferred;
                }
            }),
            asyncLoadEnabled: true,
            pageSize: 3,
            requireTotalCount: true,
            remoteOperations: { filtering: true, sorting: true, paging: true }
        }),
        loaded,
        reloaded;

    source.load().done(function() {
        loaded = true;
    });

    this.clock.tick();


    //act
    source.reload().done(function() {
        reloaded = true;
    });

    totalCountDeferred.resolve(10);

    totalCountDeferred = $.Deferred();
    totalCountDeferred.resolve(3);

    this.clock.tick();

    //assert
    assert.ok(!loaded);
    assert.ok(reloaded);
    assert.equal(source.totalCount(), 3);
});

QUnit.test("pageIndex in dataSource options", function(assert) {
    var source = createDataSource({
        store: TEN_NUMBERS,
        pageSize: 3,
        pageIndex: 1
    });

    //act
    source.load();

    //assert
    assert.equal(source.pageIndex(), 1);
});

//B233043
QUnit.test("pageIndex greater then pageCount in dataSource options", function(assert) {
    var source = createDataSource({
        store: TEN_NUMBERS,
        pageSize: 3,
        pageIndex: 5,
        requireTotalCount: true
    });

    //act
    source.load();

    //assert
    assert.equal(source.pageIndex(), 3);
});

//B233043
QUnit.test("pageIndex equals pageCount in dataSource options", function(assert) {
    var source = createDataSource({
        store: TEN_NUMBERS,
        pageSize: 3,
        pageIndex: 4,
        requireTotalCount: true
    });

    //act
    source.load();

    //assert
    assert.equal(source.pageIndex(), 3);
});

QUnit.test("pageIndex correction before change event", function(assert) {
    var source = createDataSource({
            store: new ArrayStore(TEN_NUMBERS),
            pageSize: 3,
            pageIndex: 5,
            requireTotalCount: true
        }),
        changeCallCount = 0;

    source.changed.add(function() {
        changeCallCount++;
    });

    //act
    source.load();

    this.clock.tick();

    //assert
    assert.equal(changeCallCount, 1);
    assert.equal(source.pageIndex(), 3);
});

QUnit.test("change pageIndex to greater then pageSize", function(assert) {
    var source = createDataSource({
        store: TEN_NUMBERS,
        pageSize: 3,
        pageIndex: 1,
        requireTotalCount: true
    });
    source.load();

    //act
    source.pageIndex(5);
    source.load();

    //assert
    assert.equal(source.pageIndex(), 3);
});

QUnit.test("itemsCount calculation", function(assert) {
    var source = createDataSource({
        store: TEN_NUMBERS,
        pageSize: 3,
        requireTotalCount: true
    });

    //act
    source.load();

    //assert
    assert.equal(source.itemsCount(), 3);
});


QUnit.test("pageCount calculation", function(assert) {
    var source = createDataSource({
        store: TEN_NUMBERS,
        pageSize: 3,
        requireTotalCount: true
    });

    //act
    source.load();

    //assert
    assert.equal(source.pageCount(), 4);
});

QUnit.test("pageCount calculation after change pageSize", function(assert) {
    var source = createDataSource({
        store: TEN_NUMBERS,
        pageSize: 3,
        requireTotalCount: true
    });

    //act
    source.load();
    source.pageSize(5);

    //assert
    assert.equal(source.pageCount(), 2);
});

//B237822
QUnit.test("pageCount calculation after reload when query count resolved after enumerate", function(assert) {
    var dataSource = createDataSource({
            store: TEN_NUMBERS,
            pageSize: 3,
            asyncLoadEnabled: true,
            requireTotalCount: true,
            remoteOperations: { filtering: true, sorting: true, paging: true }
        }),
        query = {
            slice: function() {
                return this;
            },
            countCalculator: null,
            countDeferred: $.Deferred(),
            count: function() {
                this.countDeferred = $.Deferred();
                if(this.countCalculator) {
                    this.countDeferred.resolve(this.countCalculator());
                }
                return this.countDeferred;
            },
            enumerateCalculator: null,
            enumerateDeferred: $.Deferred(),
            enumerate: function() {
                this.enumerateDeferred = $.Deferred();
                if(this.enumerateCalculator) {
                    this.enumerateDeferred.resolve(this.enumerateCalculator());
                }
                return this.enumerateDeferred;
            }
        },
        finalized;

    dataSource._dataSource._store.createQuery = function() {
        return query;
    };

    query.enumerateCalculator = function() {
        setTimeout(function() {
            query.countDeferred.resolve(10);
        });
        return [1, 2, 3];
    };

    dataSource.load().done(function() {

        query.enumerateCalculator = function() {
            return [2, 3, 4];
        };

        query.countCalculator = function() {
            return 9;
        };

        //act
        dataSource.reload().done(function() {
            finalized = true;
        });
    });

    this.clock.tick();

    //assert
    assert.ok(finalized);
    assert.equal(dataSource.pageCount(), 3);
    assert.equal(dataSource.totalItemsCount(), 9);
    assert.deepEqual(dataSource.items(), [2, 3, 4]);
});

QUnit.test("isLastPage and hasKnownLastPage for first page", function(assert) {
    var source = createDataSource({
        store: new ArrayStore(TEN_NUMBERS),
        pageSize: 3,
        requireTotalCount: true
    });

    //act
    source.load();

    //assert
    assert.ok(!source.isLastPage());
    assert.ok(source.hasKnownLastPage());
});

QUnit.test("isLastPage for first page when totalCount = -1", function(assert) {
    var source = createDataSource({
        store: new CustomStore({
            load: function() {
                return TEN_NUMBERS;
            },
            totalCount: function() {
                return -1;
            }
        }),
        remoteOperations: { filtering: true, sorting: true, paging: true },
        pageSize: 3,
        requireTotalCount: true
    });

    //act
    source.load();

    //assert
    assert.ok(!source.isLastPage());
    assert.ok(!source.hasKnownLastPage());
});


QUnit.test("isLastPage and hasKnownLastPage for last page", function(assert) {
    var source = createDataSource({
        store: new ArrayStore(TEN_NUMBERS),
        pageSize: 3,
        pageIndex: 3,
        requireTotalCount: true
    });

    //act
    source.load();

    //assert
    assert.ok(source.isLastPage());
    assert.ok(source.hasKnownLastPage());
});

QUnit.test("groupingHelper when remoteOperations is auto and ArrayStore", function(assert) {
    //act
    var dataSource = createDataSource({
        store: TEN_NUMBERS,
        remoteOperations: 'auto'
    });

    //assert
    assert.ok(dataSource._grouping instanceof CollapsedGroupingHelper);
});

QUnit.test("groupingHelper when remoteOperations is auto and CustomStore", function(assert) {
    //act
    var dataSource = createDataSource({
        load: function() { },
        remoteOperations: 'auto'
    });

    //assert
    assert.ok(dataSource._grouping instanceof CollapsedGroupingHelper);
});

QUnit.test("groupingHelper when remoteOperations is auto and ODataStore", function(assert) {
    //act
    var dataSource = createDataSource({
        store: {
            type: "odata",
            url: "test"
        },
        remoteOperations: 'auto'
    });

    //assert
    assert.ok(dataSource._grouping instanceof ExpandedGroupingHelper);
});

//T298483
QUnit.test("ODataStore customQueryParams/select when remoteOperations false", function(assert) {
    var store = new ODataStore({
            url: "test"
        }),
        source = createDataSource({
            store: store,
            select: ["field1", "field2"],
            customQueryParams: { test: true },
            remoteOperations: false,
            pageSize: 3,
            requireTotalCount: true
        });

    store.load = sinon.spy(function(parameters) {
        return $.Deferred().resolve(TEN_NUMBERS);
    });

    //act
    source.load();

    //assert
    assert.ok(!source.isLastPage());
    assert.ok(source.hasKnownLastPage());
    assert.equal(store.load.callCount, 1);
    assert.deepEqual(store.load.firstCall.args[0].customQueryParams, { test: true });
    assert.deepEqual(store.load.firstCall.args[0].select, ["field1", "field2"]);
});

//T298483
QUnit.test("ODataStore customQueryParams when remoteOperations true", function(assert) {
    var store = new ODataStore({
            url: "test"
        }),
        source = createDataSource({
            store: store,
            customQueryParams: { test: true },
            remoteOperations: { filtering: true, sorting: true, paging: true },
            pageSize: 3,
            requireTotalCount: true
        });

    store.load = sinon.spy(function(parameters) {
        return $.Deferred().resolve([0, 1, 2], { totalCount: 3 });
    });

    //act
    source.load();

    //assert
    assert.ok(!source.isLastPage());
    assert.ok(source.hasKnownLastPage());
    assert.equal(store.load.callCount, 1);
    assert.deepEqual(store.load.firstCall.args[0].customQueryParams, { test: true });
    assert.strictEqual(store.load.firstCall.args[0].skip, 0);
    assert.strictEqual(store.load.firstCall.args[0].take, 3);
});

//T474591
QUnit.test("No error when store returned non-array", function(assert) {
    //arrange
    var source = createDataSource({
        load: function() {
            return $.Deferred().resolve({ /* no data property */ });
        }
    });

    //act
    source.load();

    //assert
    assert.ok(true, "There are no exceptions");
});

QUnit.test("createOffsetFilter should generate filters with =/<> filter operations for boolean values", function(assert) {
    //arrange

    var booleanValues = [null, false, true];
    var descValues = [false, true];

    function checkFilter(filter) {
        if(Array.isArray(filter)) {
            if(Array.isArray(filter[0])) {
                filter.forEach(checkFilter);
            } else {
                if(filter[1] !== "=" && filter[1] !== "<>") {
                    assert.ok(false, "filter contains incorrect filter operation '" + filter[1] + "'");
                }
            }
        }
    }

    descValues.forEach(function(desc) {
        booleanValues.forEach(function(value, index) {
            var filter = createOffsetFilter([value], { group: [{ selector: "this", desc: desc }] });

            checkFilter(filter);
            assert.deepEqual(dataQuery(booleanValues).filter(filter).toArray(), desc ? booleanValues.slice(index + 1) : booleanValues.slice(0, index), "filter for value " + value + " and desc " + false + " is correct");
        });
    });
});

QUnit.module("DataSource when not requireTotalCount", {
    beforeEach: function() {
        this.dataSource = createDataSource({
            store: new ArrayStore(TEN_NUMBERS),
            pageSize: 3,
            requireTotalCount: false
        });
    }
});

QUnit.test("isLastPage and hasKnownLastPagefor first page", function(assert) {
    var source = this.dataSource;
    //act
    source.load();

    //assert
    assert.ok(!source.isLastPage());
    assert.ok(!source.hasKnownLastPage());
});

QUnit.test("isLastPage and hasKnownLastPage for last page", function(assert) {
    var source = this.dataSource;
    source.pageIndex(3);
    //act
    source.load();

    //assert
    assert.ok(source.isLastPage());
    assert.ok(source.hasKnownLastPage());
});

QUnit.test("isLastPage and hasKnownLastPage for first page after last page", function(assert) {
    var source = this.dataSource;
    source.pageIndex(3);
    source.load();

    //act
    source.pageIndex(0);
    source.load();

    //assert
    assert.ok(!source.isLastPage());
    assert.ok(source.hasKnownLastPage());
});

QUnit.test("totalCount for first page", function(assert) {
    var source = this.dataSource;
    //act
    source.load();

    //assert
    assert.equal(source.totalCount(), 3);
});

QUnit.test("totalCount for last page", function(assert) {
    var source = this.dataSource;
    source.pageIndex(3);
    //act
    source.load();

    //assert
    assert.equal(source.totalCount(), 10);
});

QUnit.test("totalCount for page after last", function(assert) {
    var source = this.dataSource;
    source.pageIndex(5);
    //act
    source.load();

    //assert
    assert.equal(source.totalCount(), 15);
});

QUnit.test("pageIndex greater then pages count", function(assert) {
    var source = this.dataSource;
    source.pageIndex(5);
    //act
    source.load();

    //assert
    assert.equal(source.pageIndex(), 4);
});

QUnit.test("pageIndex equals pages count when last page has items count equals pageSize", function(assert) {
    var source = this.dataSource;
    source.pageSize(5);
    source.pageIndex(2);
    //act
    source.load();

    //assert
    assert.equal(source.pageIndex(), 1);
    assert.equal(source.items().length, 5);
});


QUnit.module("DataSource without cache", {
    beforeEach: function() {
        this.dataSource = createDataSource({
            store: TEN_NUMBERS,
            pageSize: 3,
            requireTotalCount: true
        });
    }
});

QUnit.test("first load", function(assert) {
    var loadedCount = 0;
    var source = this.dataSource;

    source.loadingChanged.add(function(isLoading) {
        if(!isLoading) {
            loadedCount++;
        }
    });

    //act
    source.load();

    //assert
    assert.equal(loadedCount, 1);
});

QUnit.test("load next page", function(assert) {
    var loadedCount = 0;
    var source = this.dataSource;

    source.loadingChanged.add(function(isLoading) {
        if(!isLoading) {
            loadedCount++;
        }
    });

    source.load();

    //act
    source.pageIndex(1);
    source.load();

    //assert
    assert.strictEqual(source.pageIndex(), 1);
    assert.strictEqual(loadedCount, 2);
});

QUnit.test("second load page", function(assert) {
    var loadedCount = 0;
    var source = this.dataSource;


    source.load();
    source.pageIndex(1);
    source.load();

    source.loadingChanged.add(function(isLoading) {
        if(!isLoading) {
            loadedCount++;
        }
    });

    //act
    source.pageIndex(0);
    source.load();

    //assert
    assert.strictEqual(loadedCount, 1);
});


QUnit.test("integer pageIndex", function(assert) {
    var source = this.dataSource;

    source.load();

    //act
    source.pageIndex(1);
    source.load();

    //assert
    assert.strictEqual(source.pageIndex(), 1);
    assert.strictEqual(source.items().length, 3);
    assert.deepEqual(source.items(), [4, 5, 6]);
});

QUnit.module("Grouping with basic remoteOperations", {
    beforeEach: function() {
        this.array = [
            { field1: 1, field2: 2, field3: 3 },
            { field1: 1, field2: 2, field3: 4 },
            { field1: 1, field2: 3, field3: 5 },
            { field1: 2, field2: 4, field3: 6 }
        ];
        this.createDataSource = function(options) {
            return createDataSource($.extend({
                store: this.array,
                paginate: true,
                group: 'field1',
                requireTotalCount: true,
                remoteOperations: { filtering: true, sorting: true, paging: true }
            }, options || {}));
        };
        this.clock = sinon.useFakeTimers();
    },
    afterEach: function() {
        this.clock.restore();
    }
});

QUnit.test("grouping without paginate", function(assert) {
    var source = this.createDataSource({
        paginate: false
    });

    //act
    source.load();
    assert.equal(source.totalItemsCount(), 4);
    assert.deepEqual(source.items(), [{
        key: 1, items: [
            { field1: 1, field2: 2, field3: 3 },
            { field1: 1, field2: 2, field3: 4 },
            { field1: 1, field2: 3, field3: 5 }
        ]
    }, {
        key: 2, items: [{ field1: 2, field2: 4, field3: 6 }]
    }]);
});

//T137160
QUnit.test("collapse group with undefined value when grouping without paginate", function(assert) {
    var source = this.createDataSource({
        paginate: false,
        group: 'field0'
    });

    source.load();
    var changeRowExpandResult = source.changeRowExpand([undefined]);
    source.load();

    //act
    assert.equal(source.totalItemsCount(), 1);
    assert.deepEqual(source.items(), [{
        key: undefined, items: null
    }]);
    assert.ok(changeRowExpandResult && changeRowExpandResult.done);
});

//T136667
QUnit.test("collapse group with date value when grouping without paginate", function(assert) {
    var source = this.createDataSource({
        store: [
            { field1: new Date(2012, 1, 5), field2: 1 },
            { field1: new Date(2012, 1, 5), field2: 2 },
            { field1: new Date(2012, 2, 5), field2: 3 }
        ],
        paginate: false,
        group: 'field1'
    });

    source.load();
    source.changeRowExpand([new Date(2012, 1, 5)]);
    source.load();

    //act
    assert.equal(source.totalItemsCount(), 2);
    assert.deepEqual(source.items(), [{
        key: new Date(2012, 1, 5), items: null
    }, {
        key: new Date(2012, 2, 5), items: [{ field1: new Date(2012, 2, 5), field2: 3 }]
    }]);
});

QUnit.test("keys for items in groups", function(assert) {
    var source = this.createDataSource({
        store: new ArrayStore({ key: 'field3', data: this.array }),
        paginate: false
    });

    //act
    source.load();

    assert.equal(source.totalItemsCount(), 4);
    assert.deepEqual(source.items(), [{
        key: 1, items: [
            { field1: 1, field2: 2, field3: 3 },
            { field1: 1, field2: 2, field3: 4 },
            { field1: 1, field2: 3, field3: 5 }
        ]
    }, {
        key: 2, items: [
            { field1: 2, field2: 4, field3: 6 }
        ]
    }]);
});

QUnit.test("grouping with pageSize more items count", function(assert) {
    var source = this.createDataSource();

    //act
    source.load();

    assert.equal(source.totalItemsCount(), 4);
    assert.deepEqual(source.items(), [{
        key: 1, items: [
            { field1: 1, field2: 2, field3: 3 },
            { field1: 1, field2: 2, field3: 4 },
            { field1: 1, field2: 3, field3: 5 }
        ]
    }, {
        key: 2, items: [{ field1: 2, field2: 4, field3: 6 }]
    }]);

    assert.equal(source.itemsCount(), 6);
});

//T105748
QUnit.test("grouping with sorting", function(assert) {
    var source = this.createDataSource({
        sort: 'field3',
        store: [
            { field1: 1, field2: 2, field3: 1 },
            { field1: 1, field2: 2, field3: 2 },
            { field1: 1, field2: 2, field3: 4 },
            { field1: 1, field2: 2, field3: 3 },
            { field1: 1, field2: 2, field3: 5 },
            { field1: 1, field2: 2, field3: 6 },
            { field1: 1, field2: 2, field3: 7 },
            { field1: 2, field2: 3, field3: 8 },
            { field1: 2, field2: 3, field3: 9 },
            { field1: 2, field2: 3, field3: 10 },
            { field1: 2, field2: 3, field3: 11 }
        ]
    });

    //act
    source.load();

    //assert
    assert.equal(source.totalItemsCount(), 11);
    assert.deepEqual(source.items(), [{
        key: 1, items: [
            { field1: 1, field2: 2, field3: 1 },
            { field1: 1, field2: 2, field3: 2 },
            { field1: 1, field2: 2, field3: 3 },
            { field1: 1, field2: 2, field3: 4 },
            { field1: 1, field2: 2, field3: 5 },
            { field1: 1, field2: 2, field3: 6 },
            { field1: 1, field2: 2, field3: 7 }
        ]
    }, {
        key: 2, items: [
            { field1: 2, field2: 3, field3: 8 },
            { field1: 2, field2: 3, field3: 9 },
            { field1: 2, field2: 3, field3: 10 },
            { field1: 2, field2: 3, field3: 11 }
        ]
    }]);
    assert.equal(source.itemsCount(), 13);
});

QUnit.test("grouping with pageSize less items count", function(assert) {
    var source = this.createDataSource({
        pageSize: 2
    });

    //act
    source.load();

    assert.equal(source.totalItemsCount(), 4);
    assert.deepEqual(source.items(), [{
        key: 1, isContinuationOnNextPage: true, items: [
            { field1: 1, field2: 2, field3: 3 },
            { field1: 1, field2: 2, field3: 4 }
        ]
    }]);
    assert.equal(source.itemsCount(), 3);
});

QUnit.test("grouping with pageSize less items count. Continue group parameter", function(assert) {
    var source = this.createDataSource({
        pageSize: 2,
        pageIndex: 1
    });

    //act
    source.load();

    assert.equal(source.totalItemsCount(), 4);
    assert.deepEqual(source.items(), [{
        key: 1, isContinuation: true, items: [
            { field1: 1, field2: 3, field3: 5 }
        ]
    }, {
        key: 2, items: [{ field1: 2, field2: 4, field3: 6 }]
    }]);
    assert.equal(source.itemsCount(), 4, 'items count with continue group');
});

QUnit.test("grouping with pageSize less items count. Continue group parameter when virtual scrolling", function(assert) {
    var source = this.createDataSource({
        pageSize: 2,
        pageIndex: 1,
        scrolling: { mode: 'virtual', preventPreload: true }
    });

    //act
    source.load();

    assert.equal(source.totalItemsCount(), 4);
    assert.deepEqual(source.items(), [{
        key: 1, isContinuation: true, items: [
            { field1: 1, field2: 3, field3: 5 }
        ]
    }, {
        key: 2, items: [{ field1: 2, field2: 4, field3: 6 }]
    }]);
    assert.equal(source.itemsCount(), 3, 'items count without continue group');
});

QUnit.test("collapse group on first page after loading second page", function(assert) {
    var source = this.createDataSource({
        pageSize: 2,
        scrolling: { mode: 'virtual', preventPreload: true }
    });

    //act
    source.load();
    source.pageIndex(1);
    source.load();

    //assert
    assert.equal(source.itemsCount(), 6);

    //act
    source.changeRowExpand([1]);
    source.load();

    //assert
    assert.equal(source.totalItemsCount(), 2);
    assert.deepEqual(source.items(), [{
        key: 1, items: null
    }, {
        key: 2, items: [{ field1: 2, field2: 4, field3: 6 }]
    }]);
    assert.equal(source.itemsCount(), 3, 'items count without continue group');
});


QUnit.test("changed callback fired after changeRowExpand", function(assert) {
    var source = this.createDataSource({
        pageSize: 3,
        store: [
            { field1: 1, field2: 2, field3: 3 },
            { field1: 1, field2: 2, field3: 4 },
            { field1: 2, field2: 3, field3: 5 },
            { field1: 3, field2: 4, field3: 6 }
        ]
    });

    //act
    source.load();
    source.changed.add(function() {
        //assert
        assert.equal(source.itemsCount(), 5);
        assert.deepEqual(source.items(), [{
            key: 1, items: null,
        }, {
            key: 2, items: [{ field1: 2, field2: 3, field3: 5 }]
        }, {
            key: 3, items: [{ field1: 3, field2: 4, field3: 6 }]
        }]);
    });

    //act
    source.changeRowExpand([1]);
    source.load();
});

QUnit.test("changed callback fired after changeRowExpand when no groups", function(assert) {
    var source = this.createDataSource({
        pageSize: 3,
        group: null,
        store: [
            { field1: 1, field2: 2, field3: 3 },
            { field1: 1, field2: 2, field3: 4 },
            { field1: 2, field2: 3, field3: 5 },
            { field1: 3, field2: 4, field3: 6 }
        ]
    });

    var isChanged = false;

    source.load();
    source.changed.add(function() {
        isChanged = true;
    });

    //act
    source.changeRowExpand([1]);
    source.load();

    //assert
    assert.ok(isChanged, 'changed called');
});

QUnit.test("grouping with pageSize less items count. Continue group parameter not set when previous page ends with collapsed group", function(assert) {
    var source = this.createDataSource({
        pageSize: 3,
        store: [
            { field1: 1, field2: 2, field3: 3 },
            { field1: 1, field2: 2, field3: 4 },
            { field1: 2, field2: 3, field3: 5 },
            { field1: 3, field2: 4, field3: 6 }
        ]
    });

    //act
    source.load();
    source.changeRowExpand([2]);
    source.pageIndex(1);
    source.load();

    assert.equal(source.totalItemsCount(), 4);
    assert.deepEqual(source.items(), [{
        key: 3, items: [{ field1: 3, field2: 4, field3: 6 }]
    }]);
});

QUnit.test("grouping with pageSize less items count. Continue group parameter not set", function(assert) {
    var source = this.createDataSource({
        pageSize: 3,
        pageIndex: 1
    });

    //act
    source.load();

    assert.equal(source.totalItemsCount(), 4);
    assert.deepEqual(source.items(), [{
        key: 2, items: [{ field1: 2, field2: 4, field3: 6 }]
    }]);
});

QUnit.test("grouping with pageSize less items count. Continue on next page group parameter", function(assert) {
    var source = this.createDataSource({
        pageSize: 2
    });

    //act
    source.load();

    assert.equal(source.totalItemsCount(), 4);
    assert.deepEqual(source.items(), [{
        key: 1, isContinuationOnNextPage: true, items: [
                    { field1: 1, field2: 2, field3: 3 },
                    { field1: 1, field2: 2, field3: 4 }
        ]
    }]);
});

QUnit.test("grouping with pageSize less items count. Continue on next page group parameter when has collapsed item", function(assert) {
    var source = this.createDataSource({
        pageSize: 2,
        store: [
            { field1: 1, field2: 2, field3: 3 },
            { field1: 1, field2: 2, field3: 4 },
            { field1: 1, field2: 3, field3: 5 },
            { field1: 2, field2: 4, field3: 6 },
            { field1: 2, field2: 4, field3: 7 }
        ]
    });

    //act
    source.load();
    source.changeRowExpand([1]);
    source.load();
    assert.equal(source.totalItemsCount(), 3);
    assert.deepEqual(source.items(), [{
        key: 1, items: null
    }, {
        key: 2, isContinuationOnNextPage: true, items: [
            { field1: 2, field2: 4, field3: 6 }
        ]
    }]);
});

QUnit.test("grouping with pageSize less items count. Not Continue on next page group parameter when all items on group on current page", function(assert) {
    var source = this.createDataSource({
        pageSize: 3
    });

    //act
    source.load();

    assert.equal(source.totalItemsCount(), 4);
    assert.deepEqual(source.items(), [{
        key: 1, items: [
            { field1: 1, field2: 2, field3: 3 },
            { field1: 1, field2: 2, field3: 4 },
            { field1: 1, field2: 3, field3: 5 }
        ]
    }]);
});

QUnit.test("grouping without paginate. Collapse group", function(assert) {
    var source = this.createDataSource({
        paginate: false
    });

    source.load();
    source.changeRowExpand([1]);
    source.load();

    assert.equal(source.totalItemsCount(), 2);
    assert.deepEqual(source.items(), [{
        key: 1, items: null
    }, {
        key: 2, items: [{ field1: 2, field2: 4, field3: 6 }]
    }]);
    assert.equal(source.itemsCount(), 3);
});

QUnit.test("grouping without paginate. Expand group after collapse", function(assert) {
    var source = this.createDataSource({
        paginate: false
    });

    source.load();

    source.changeRowExpand([1]);
    source.load();
    source.changeRowExpand([1]);
    source.load();

    assert.equal(source.totalItemsCount(), 4);
    assert.deepEqual(source.items(), [{
        key: 1, items: [
            { field1: 1, field2: 2, field3: 3 },
            { field1: 1, field2: 2, field3: 4 },
            { field1: 1, field2: 3, field3: 5 }
        ]
    }, {
        key: 2, items: [{ field1: 2, field2: 4, field3: 6 }]
    }]);
});


QUnit.test("grouping with paginate. Collapse group", function(assert) {
    var source = this.createDataSource({});

    source.load();

    source.changeRowExpand([1]);
    source.load();

    assert.equal(source.totalItemsCount(), 2);
    assert.deepEqual(source.items(), [{
        key: 1, items: null
    }, {
        key: 2, items: [{ field1: 2, field2: 4, field3: 6 }]
    }]);
});

QUnit.test("grouping with paginate. Collapse group when remote sorting and local sorting are different", function(assert) {
    var arrayStore = new ArrayStore([
            { field1: "ES", field2: 1 },
            { field1: "ES", field2: 2 },
            { field1: "ES", field2: 3 },
            { field1: "ES", field2: 4 },
            { field1: "ES", field2: 5 },
            { field1: "Gy??r", field2: 6 },
            { field1: "Gy??r", field2: 7 },
            { field1: "Gy??r", field2: 8 },
            { field1: "Gy??r", field2: 9 },
            { field1: "Gy??r", field2: 10 },
            { field1: "G??d", field2: 11 },
            { field1: "G??d", field2: 12 },
            { field1: "G??d", field2: 13 },
            { field1: "G??d", field2: 14 },
            { field1: "G??d", field2: 15 }
    ]);

    var source = this.createDataSource({
        pageSize: 4,
        store: new CustomStore({
            load: function(options) {
                var d = $.Deferred();
                if(options.sort) {
                    options.sort[0].selector = function(data) {
                        return $.inArray(data.field1, ["ES", "G??d", "Gy??r"]);
                    };
                }
                $.when(arrayStore.load(options), arrayStore.totalCount(options)).done(function(items, totalCount) {
                    d.resolve(items, { totalCount: totalCount });
                });
                return d;
            }
        })
    });

    source.load();

    //act
    source.changeRowExpand(["ES"]);
    source.load();
    source.changeRowExpand(["G??d"]);
    source.load();

    //assert
    assert.deepEqual(source.items(), [{
        key: "ES", items: null
    }, {
        key: "G??d", items: null
    }, {
        key: "Gy??r", isContinuationOnNextPage: true, items: [
            { field1: "Gy??r", field2: 6 },
            { field1: "Gy??r", field2: 7 }
        ]
    }]);

    //act
    source.changeRowExpand(["Gy??r"]);
    source.load();

    //assert
    assert.deepEqual(source.items(), [{
        key: "ES", items: null
    }, {
        key: "G??d", items: null
    }, {
        key: "Gy??r", items: null
    }]);
});

QUnit.test("grouping with paginate. Collapse group when CustomStore used", function(assert) {
    var arrayStore = new ArrayStore(this.array);

    var source = this.createDataSource({
        store: new CustomStore({
            load: function(options) {
                var d = $.Deferred();
                $.when(arrayStore.load(options), arrayStore.totalCount(options)).done(function(items, totalCount) {
                    d.resolve(items, { totalCount: totalCount });
                });
                return d;
            }
        })
    });

    source.load();

    source.changeRowExpand([1]);
    source.load();

    assert.equal(source.totalItemsCount(), 2);
    assert.deepEqual(source.items(), [{
        key: 1, items: null
    }, {
        key: 2, items: [{ field1: 2, field2: 4, field3: 6 }]
    }]);
});

QUnit.test("grouping with paginate. Collapse group when dataSource has filter", function(assert) {
    var source = this.createDataSource({
        store: [
            { field1: 1, field2: 2, field3: 3 },
            { field1: 1, field2: 2, field3: 4 },
            { field1: 1, field2: 3, field3: 5 },
            { field1: 2, field2: 4, field3: 6 },
            { field1: 2, field2: 4, field3: 7 }
        ],
        filter: ['field3', '>', 4]
    });

    source.load();
    source.changeRowExpand([2]);
    source.load();

    assert.equal(source.totalItemsCount(), 2);
    assert.deepEqual(source.items(), [{
        key: 1, items: [{ field1: 1, field2: 3, field3: 5 }]
    }, {
        key: 2, items: null
    }]);
});

QUnit.test("grouping with paginate. Collapse group when dataSource has filter 2", function(assert) {
    var source = this.createDataSource({
        store: [
            { field1: 1, field2: 2, field3: 3 },
            { field1: 1, field2: 2, field3: 4 },
            { field1: 1, field2: 3, field3: 5 },
            { field1: 2, field2: 4, field3: 6 },
            { field1: 2, field2: 4, field3: 7 }
        ],
        filter: ['field3', '>', 4]
    });

    source.load();
    source.changeRowExpand([1]);
    source.load();

    assert.equal(source.totalItemsCount(), 3);
    assert.deepEqual(source.items(), [{
        key: 1, items: null,
    }, {
        key: 2, items: [{ field1: 2, field2: 4, field3: 6 }, { field1: 2, field2: 4, field3: 7 }]
    }]);
    assert.equal(source.itemsCount(), 4);
});

QUnit.test("grouping with paginate. Expand group after collapse", function(assert) {
    var source = this.createDataSource({});

    source.load();

    source.changeRowExpand([1]);
    source.load();
    source.changeRowExpand([1]);
    source.load();

    assert.equal(source.totalItemsCount(), 4);
    assert.deepEqual(source.items(), [{
        key: 1, items: [
            { field1: 1, field2: 2, field3: 3 },
            { field1: 1, field2: 2, field3: 4 },
            { field1: 1, field2: 3, field3: 5 }
        ]
    }, {
        key: 2, items: [{ field1: 2, field2: 4, field3: 6 }]
    }]);
});

QUnit.test("grouping with paginate. Update group offsets after expand by correct page offset", function(assert) {
    var array = [
        { field1: 1, field2: 2, field3: 3 },
        { field1: 1, field2: 2, field3: 4 },
        { field1: 1, field2: 3, field3: 5 },
        { field1: 2, field2: 4, field3: 6 },
        { field1: 2, field2: 5, field3: 7 },
        { field1: 3, field2: 6, field3: 8 }
    ];
    var source = this.createDataSource({
        store: array,
        pageSize: 3
    });

    source.load();

    source.changeRowExpand([1]);
    source.load();
    source.changeRowExpand([2]);
    source.load();
    source.changeRowExpand([3]);
    source.load();
    //act
    source.changeRowExpand([2]);
    source.load();
    source.pageIndex(1);
    source.load();
    source.changeRowExpand([3]);
    source.load();

    assert.deepEqual(source.getGroupsInfo(), [ //TODO make public method for test
        { key: 1, children: [], offset: 0, data: { count: 3, offset: 0, path: [1], isExpanded: false } },
        { key: 2, children: [], offset: 3, data: { count: 2, offset: 3, path: [2], isExpanded: true } },
        { key: 3, children: [], offset: 5, data: { count: 1, offset: 5, path: [3], isExpanded: true } }
    ]);

    assert.equal(source.items().length, 1);
    assert.deepEqual(source.items(), [{
        key: 3, items: [
            { field1: 3, field2: 6, field3: 8 }
        ]
    }]);
});

QUnit.test("sort group on add groupsInfo", function(assert) {
    var source = this.createDataSource({
        store: [],
        pageSize: 3
    });

    source.load();

    source._grouping.addGroupInfo({ offset: 3, path: "1" });
    source._grouping.addGroupInfo({ offset: 2, path: "2" });
    source._grouping.addGroupInfo({ offset: 0, path: "3" });
    source._grouping.addGroupInfo({ offset: 7, path: "4" });

    var offsets = $.map(source.getGroupsInfo(), function(g) {
        return g.offset;
    });

    assert.deepEqual(offsets, [0, 2, 3, 7]);
});

//T231326
QUnit.test("grouping with paginate. Update group offsets after expand by correct page offset 2", function(assert) {
    var array = [
        { field1: 1, field2: 1, field3: 1 },
        { field1: 1, field2: 2, field3: 2 },
        { field1: 1, field2: 2, field3: 3 },
        { field1: 1, field2: 2, field3: 4 },
        { field1: 1, field2: 2, field3: 5 },
        { field1: 1, field2: 2, field3: 6 },
        { field1: 1, field2: 2, field3: 7 },
        { field1: 1, field2: 2, field3: 8 },
        { field1: 1, field2: 2, field3: 9 },
        { field1: 1, field2: 2, field3: 10 },
        { field1: 1, field2: 2, field3: 11 },
        { field1: 1, field2: 2, field3: 12 },
        { field1: 1, field2: 2, field3: 13 },
        { field1: 1, field2: 2, field3: 14 },
        { field1: 1, field2: 2, field3: 15 },
        { field1: 1, field2: 2, field3: 16 },
        { field1: 1, field2: 2, field3: 17 },
        { field1: 1, field2: 2, field3: 18 },
        { field1: 1, field2: 2, field3: 19 },
        { field1: 1, field2: 2, field3: 20 },

        { field1: 1, field2: 2, field3: 21 },
        { field1: 1, field2: 2, field3: 22 },
        { field1: 1, field2: 2, field3: 23 },
        { field1: 1, field2: 2, field3: 24 },
        { field1: 1, field2: 2, field3: 25 },
        { field1: 1, field2: 2, field3: 26 },
        { field1: 1, field2: 2, field3: 27 },
        { field1: 1, field2: 2, field3: 28 },
        { field1: 1, field2: 2, field3: 29 },
        { field1: 1, field2: 2, field3: 30 },
        { field1: 1, field2: 2, field3: 31 },
        { field1: 1, field2: 2, field3: 32 },
        { field1: 1, field2: 2, field3: 33 },
        { field1: 1, field2: 2, field3: 34 },
        { field1: 1, field2: 2, field3: 35 },
        { field1: 1, field2: 2, field3: 36 },
        { field1: 1, field2: 2, field3: 37 },
        { field1: 1, field2: 2, field3: 38 },
        { field1: 1, field2: 2, field3: 39 },
        { field1: 1, field2: 2, field3: 40 },

        { field1: 1, field2: 2, field3: 41 },
        { field1: 1, field2: 2, field3: 42 },
        { field1: 1, field2: 2, field3: 43 },
        { field1: 1, field2: 2, field3: 44 },
        { field1: 1, field2: 2, field3: 45 },
        { field1: 1, field2: 2, field3: 46 },
        { field1: 1, field2: 2, field3: 47 },
        { field1: 1, field2: 2, field3: 48 },
        { field1: 1, field2: 2, field3: 49 },
        { field1: 1, field2: 2, field3: 50 },
        { field1: 1, field2: 2, field3: 51 },
        { field1: 1, field2: 2, field3: 52 },
        { field1: 1, field2: 2, field3: 53 },
        { field1: 1, field2: 2, field3: 54 },
        { field1: 1, field2: 2, field3: 55 },
        { field1: 1, field2: 2, field3: 56 },
        { field1: 1, field2: 3, field3: 57 },
        { field1: 1, field2: 3, field3: 58 },
        { field1: 1, field2: 3, field3: 59 },
        { field1: 1, field2: 3, field3: 60 },

        { field1: 1, field2: 3, field3: 61 },
        { field1: 1, field2: 3, field3: 62 },
        { field1: 1, field2: 3, field3: 63 },
        { field1: 1, field2: 3, field3: 64 },
        { field1: 1, field2: 3, field3: 65 },
        { field1: 1, field2: 3, field3: 66 },
        { field1: 1, field2: 3, field3: 67 },
        { field1: 1, field2: 3, field3: 68 },
        { field1: 1, field2: 3, field3: 69 },
        { field1: 1, field2: 3, field3: 70 },
        { field1: 1, field2: 3, field3: 71 },
        { field1: 1, field2: 3, field3: 72 },
        { field1: 1, field2: 3, field3: 73 },
        { field1: 1, field2: 3, field3: 74 },
        { field1: 1, field2: 3, field3: 75 },
        { field1: 1, field2: 4, field3: 76 },
        { field1: 1, field2: 4, field3: 77 },
        { field1: 1, field2: 4, field3: 78 },
        { field1: 1, field2: 4, field3: 79 },
        { field1: 1, field2: 4, field3: 80 },

        { field1: 1, field2: 4, field3: 81 },
        { field1: 1, field2: 4, field3: 82 },
        { field1: 1, field2: 4, field3: 83 },
        { field1: 1, field2: 4, field3: 84 },
        { field1: 1, field2: 4, field3: 85 },
        { field1: 1, field2: 4, field3: 86 },
        { field1: 1, field2: 4, field3: 87 },
        { field1: 1, field2: 4, field3: 88 },
        { field1: 1, field2: 4, field3: 89 },
        { field1: 1, field2: 4, field3: 90 },
        { field1: 1, field2: 4, field3: 91 },
        { field1: 1, field2: 4, field3: 92 },
        { field1: 1, field2: 4, field3: 93 },
        { field1: 1, field2: 4, field3: 94 },
        { field1: 2, field2: 1, field3: 95 },
        { field1: 2, field2: 1, field3: 96 }
    ];
    var source = this.createDataSource({
        store: array,
        group: ["field1", "field2"],
        pageSize: 20,
        scrolling: { mode: 'virtual', preventPreload: true }
    });

    source.load();

    source.pageIndex(1);
    source.load();

    source.pageIndex(2);
    source.load();

    source.pageIndex(3);
    source.load();

    //act
    source.changeRowExpand([1, 4]);
    source.load();

    assert.deepEqual(source.getGroupsInfo(), [
        { key: 1, offset: 75, children: [{ key: 4, children: [], offset: 75, data: { count: 19, offset: 75, path: [1, 4], isExpanded: false } }], data: { isExpanded: true, offset: 75, path: [1] } }
    ]);

    assert.equal(source.items().length, 2);
    assert.deepEqual(source.items(), [{
        key: 1, isContinuation: true, items: [
            { key: 3, isContinuation: true, items: array.slice(60, 75) },
            { key: 4, items: null }
        ]
    }, {
        key: 2, items: [
            { key: 1, items: array.slice(94, 96) }
        ]
    }]);
});

//B254194, T310036
QUnit.test("hide collapsed group when after filtering group has no elements", function(assert) {
    var arrayStore = new ArrayStore(this.array);

    var source = this.createDataSource({
        store: new CustomStore({
            load: function(options) {
                var d = $.Deferred();
                setTimeout(function() {
                    arrayStore.load(options).done(d.resolve).fail(d.reject);
                });
                return d;
            },
            totalCount: function(options) {
                var d = $.Deferred();
                setTimeout(function() {
                    arrayStore.totalCount(options).done(d.resolve).fail(d.reject);
                });
                return d;
            }
        }),
        pageSize: 2
    });

    source.load();

    this.clock.tick();

    source.changeRowExpand([1]);
    source.load();

    this.clock.tick();

    //act
    source.filter(['field2', '>', 3]);
    source.reload();

    this.clock.tick();

    //assert
    assert.equal(source.totalItemsCount(), 1, 'total items count');
    assert.deepEqual(source.items(), [{
        key: 2, items: [
            { field1: 2, field2: 4, field3: 6 }
        ]
    }], 'items');
    assert.equal(source.itemsCount(), 2, 'visible items count');
});

QUnit.test("collapseAll when no grouped columns", function(assert) {
    var source = this.createDataSource({
        pageSize: 2,
        group: null
    });
    source.load();

    //act
    source.collapseAll();
    source.load();

    //assert
    assert.equal(source.pageCount(), 2, "pageCount");
    assert.deepEqual(source.items(), [
        { field1: 1, field2: 2, field3: 3 },
        { field1: 1, field2: 2, field3: 4 }
    ], "items");
});

QUnit.test("expandAll when no grouped columns", function(assert) {
    var source = this.createDataSource({
        pageSize: 2,
        group: null
    });
    source.load();

    //act
    source.expandAll();
    source.load();

    //assert
    assert.equal(source.pageCount(), 2, "pageCount");
    assert.deepEqual(source.items(), [
        { field1: 1, field2: 2, field3: 3 },
        { field1: 1, field2: 2, field3: 4 }
    ], "items");
});

QUnit.test("loadTotalCount for CustomStore when totalCount in extra", function(assert) {
    var lastLoadOptions;

    var store = new CustomStore({
        load: function(options) {
            lastLoadOptions = options;
            var d = $.Deferred();
            d.resolve([], {
                totalCount: 10
            });
            return d;
        }
    });

    //T329728
    if(store._customLoadOptions) {
        store._customLoadOptions = function() {
            return ["param1"];
        };
    }

    var dataSource = createDataSource({
        store: store,
        paginate: true,
        param1: 1,
        param2: 2,
        remoteOperations: { filtering: true, sorting: true, paging: true }
    });

    var totalCount;

    //act
    loadTotalCount(dataSource, { filter: ['this', '>=', 5] }).done(function(e) {
        totalCount = e;
    });

    //assert
    assert.deepEqual(lastLoadOptions, {
        skip: 0,
        take: 1,
        requireTotalCount: true,
        filter: ['this', '>=', 5],
        param1: 1, //T329728
    });
    assert.strictEqual(totalCount, 10);
});

QUnit.test("loadTotalCount for CustomStore when no totalCount in extra", function(assert) {
    var lastLoadOptions,
        lastTotalCountOptions;

    var store = new CustomStore({
        load: function(options) {
            lastLoadOptions = options;
            return [];
        },
        totalCount: function(options) {
            lastTotalCountOptions = options;
            return 10;
        }
    });

    var dataSource = createDataSource({
        store: store,
        paginate: true,
        remoteOperations: { filtering: true, sorting: true, paging: true }
    });

    var totalCount;

    //act
    loadTotalCount(dataSource, { filter: ['this', '>=', 5] }).done(function(e) {
        totalCount = e;
    });

    //assert
    assert.deepEqual(lastLoadOptions, {
        skip: 0,
        take: 1,
        requireTotalCount: true,
        filter: ['this', '>=', 5]
    });
    assert.deepEqual(lastTotalCountOptions, {
        skip: 0,
        take: 1,
        requireTotalCount: true,
        filter: ['this', '>=', 5]
    });
    assert.strictEqual(totalCount, 10);
});


QUnit.module("Grouping with basic remoteOperations. Second level", {
    beforeEach: function() {
        this.array = [
            { field1: 1, field2: 2, field3: 3 },
            { field1: 1, field2: 2, field3: 4 },
            { field1: 1, field2: 3, field3: 5 },
            { field1: 1, field2: 3, field3: 6 },
            { field1: 2, field2: 4, field3: 7 }
        ];
        this.createDataSource = function(options) {
            return createDataSource($.extend({
                store: this.array,
                paginate: true,
                group: ['field1', 'field2'],
                requireTotalCount: true,
                remoteOperations: { filtering: true, sorting: true, paging: true }
            }, options || {}));
        };
        this.clock = sinon.useFakeTimers();
    },
    afterEach: function() {
        this.clock.restore();
    }
});
QUnit.test("grouping with paginate", function(assert) {
    var source = this.createDataSource({
        pageSize: 3
    });

    //act
    source.load();

    assert.equal(source.totalItemsCount(), 5);
    assert.deepEqual(source.items(), [{
        key: 1, isContinuationOnNextPage: true, items: [{
            key: 2, items: [
            { field1: 1, field2: 2, field3: 3 },
            { field1: 1, field2: 2, field3: 4 }
            ]
        },
        {
            key: 3, isContinuationOnNextPage: true, items: [{ field1: 1, field2: 3, field3: 5 }]
        }
        ]
    }]);
});

//T134180
QUnit.test("grouping with paginate and totalCount from extra", function(assert) {
    var array = this.array;
    var source = this.createDataSource({
        load: function() {
            return $.Deferred().resolve(array, { totalCount: array.length }).promise();
        },
        pageSize: 3
    });

    //act
    source.load();

    assert.equal(source.totalItemsCount(), 5);
    assert.deepEqual(source.items(), [{
        key: 1, isContinuationOnNextPage: true, items: [{
            key: 2, items: [
            { field1: 1, field2: 2, field3: 3 },
            { field1: 1, field2: 2, field3: 4 }
            ]
        },
        {
            key: 3, isContinuationOnNextPage: true, items: [{ field1: 1, field2: 3, field3: 5 }]
        }
        ]
    }]);
});

QUnit.test("grouping without paginate", function(assert) {
    var source = this.createDataSource({
        paginate: false
    });

    //act
    source.load();

    assert.equal(source.totalItemsCount(), 5);
    assert.deepEqual(source.items(), [{
        key: 1, items: [{
            key: 2, items: [
                { field1: 1, field2: 2, field3: 3 },
                { field1: 1, field2: 2, field3: 4 }
            ]
        }, {
            key: 3, items: [
                { field1: 1, field2: 3, field3: 5 },
                { field1: 1, field2: 3, field3: 6 }
            ]
        }]
    }, {
        key: 2, items: [{
            key: 4, items: [
                { field1: 2, field2: 4, field3: 7 }
            ]
        }]
    }]);
});

QUnit.test("change group order when remote data", function(assert) {
    var arrayStore = new ArrayStore([
            { field1: 1, field2: 2, field3: 3 },
            { field1: 1, field2: 2, field3: 4 },
            { field1: 1, field2: 2, field3: 5 },
            { field1: 1, field2: 2, field3: 6 },
            { field1: 1, field2: 3, field3: 7 },
            { field1: 1, field2: 3, field3: 8 },
            { field1: 1, field2: 3, field3: 9 },
            { field1: 2, field2: 4, field3: 10 }
    ]);

    var source = this.createDataSource({
        pageSize: 3,
        store: new CustomStore({
            load: function(options) {
                var d = $.Deferred();
                setTimeout(function() {
                    arrayStore.load(options).done(function(data) {
                        d.resolve(data);
                    });
                });
                return d;
            },
            totalCount: function(options) {
                var d = $.Deferred();
                setTimeout(function() {
                    arrayStore.totalCount(options).done(function(totalCount) {
                        d.resolve(totalCount);
                    });
                });
                return d;
            }
        })
    });


    source.load();
    this.clock.tick();

    source.changeRowExpand([1, 2]);
    this.clock.tick();
    source.load();
    this.clock.tick();

    source.changeRowExpand([1, 3]);
    this.clock.tick();
    source.load();
    this.clock.tick();

    //act
    source.group(['field1', { selector: 'field2', desc: true }]);

    source.reload();
    this.clock.tick();

    //assert
    assert.equal(source.totalItemsCount(), 3);
    assert.deepEqual(source.items(), [{
        key: 1, items: [
            { key: 3, items: null },
            { key: 2, items: null }
        ]
    }, {
        key: 2, items: [
            {
                key: 4, items: [
                    { field1: 2, field2: 4, field3: 10 }
                ]
            }
        ]
    }]);
    assert.equal(source.itemsCount(), 6);
});


QUnit.test("Continue group parameter for first group level only", function(assert) {
    var source = this.createDataSource({
        pageSize: 2,
        pageIndex: 1
    });

    //act
    source.load();

    assert.equal(source.totalItemsCount(), 5);
    assert.deepEqual(source.items(), [{
        key: 1, isContinuation: true, items: [{
            key: 3, items: [
                { field1: 1, field2: 3, field3: 5 },
                { field1: 1, field2: 3, field3: 6 }
            ]
        }]
    }]);
});

QUnit.test("Continue group parameter for both group levels", function(assert) {
    var source = this.createDataSource({
        pageSize: 3,
        pageIndex: 1
    });

    //act
    source.load();

    assert.equal(source.totalItemsCount(), 5);
    assert.deepEqual(source.items(), [{
        key: 1, isContinuation: true, items: [
            { key: 3, isContinuation: true, items: [{ field1: 1, field2: 3, field3: 6 }] }
        ]
    }, {
        key: 2, items: [
            { key: 4, items: [{ field1: 2, field2: 4, field3: 7 }] }
        ]
    }]);
});

QUnit.test("Continue on next page group parameter for first group level only", function(assert) {
    var source = this.createDataSource({
        pageSize: 2
    });

    //act
    source.load();

    assert.equal(source.totalItemsCount(), 5);
    assert.deepEqual(source.items(), [{
        key: 1, isContinuationOnNextPage: true, items: [
            {
                key: 2, items: [
                    { field1: 1, field2: 2, field3: 3 },
                    { field1: 1, field2: 2, field3: 4 }
                ]
            }
        ]
    }]);

});

QUnit.test("Continue on next page group parameter for both group levels", function(assert) {
    var source = this.createDataSource({
        pageSize: 3
    });

    //act
    source.load();

    assert.equal(source.totalItemsCount(), 5);
    assert.deepEqual(source.items(), [{
        key: 1, isContinuationOnNextPage: true, items: [
            {
                key: 2, items: [
                    { field1: 1, field2: 2, field3: 3 },
                    { field1: 1, field2: 2, field3: 4 }
                ]
            },
            {
                key: 3, isContinuationOnNextPage: true,
                items: [{ field1: 1, field2: 3, field3: 5 }]

            }
        ]
    }]);

});

QUnit.test("Collapse second level group", function(assert) {
    var source = this.createDataSource({
        pageSize: 4
    });

    //act
    source.load();

    source.changeRowExpand([1, 3]);
    source.load();

    assert.equal(source.totalItemsCount(), 4);
    assert.deepEqual(source.items(), [{
        key: 1, items: [{
            key: 2, items: [
                { field1: 1, field2: 2, field3: 3 },
                { field1: 1, field2: 2, field3: 4 }
            ]
        }, { key: 3, items: null }
        ]
    }, {
        key: 2, items: [{
            key: 4, items: [
                { field1: 2, field2: 4, field3: 7 }
            ]
        }]
    }]);
});

QUnit.test("Collapse second level group and first level group", function(assert) {
    var source = this.createDataSource({
        pageSize: 4
    });

    //act
    source.load();

    source.changeRowExpand([1, 3]);
    source.load();
    source.changeRowExpand([1]);
    source.load();

    assert.equal(source.totalItemsCount(), 2);
    assert.deepEqual(source.items(), [{
        key: 1, items: null
    }, {
        key: 2, items: [{
            key: 4, items: [
                { field1: 2, field2: 4, field3: 7 }
            ]
        }]
    }]);
});

//T406350
QUnit.test("Collapse second level group and first level group when scrolling mode is virtual", function(assert) {
    this.array = [
            { field1: 1, field2: 1, field3: 1 },
            { field1: 1, field2: 2, field3: 2 },
            { field1: 1, field2: 2, field3: 3 },
            { field1: 1, field2: 2, field3: 4 },
            { field1: 1, field2: 2, field3: 5 },
            { field1: 1, field2: 2, field3: 6 },
            { field1: 2, field2: 1, field3: 7 }
    ];

    var source = this.createDataSource({
        pageSize: 5,
        scrolling: { mode: 'virtual', preventPreload: true }
    });

    source.viewportSize(5);

    //act
    source.load();

    source.changeRowExpand([1, 1]);
    source.load();
    source.changeRowExpand([1]);
    source.load();

    assert.equal(source.totalItemsCount(), 2);
    assert.deepEqual(source.items(), [{
        key: 1, items: null
    }, {
        key: 2, items: [{
            key: 1, items: [
                { field1: 2, field2: 1, field3: 7 }
            ]
        }]
    }]);
});

//T371565
QUnit.test("Collapse several second level groups", function(assert) {
    this.array = [
            { field1: 1, field2: 2, field3: 3 },
            { field1: 1, field2: 2, field3: 4 },
            { field1: 1, field2: 3, field3: 5 },
            { field1: 1, field2: 3, field3: 6 },
            { field1: 2, field2: 4, field3: 7 },
            { field1: 2, field2: 4, field3: 8 },
            { field1: 2, field2: 5, field3: 9 },
            { field1: 2, field2: 5, field3: 10 },
    ];

    var source = this.createDataSource({
        pageSize: 4
    });

    //act
    source.load();

    source.changeRowExpand([1, 2]);
    source.load();
    source.changeRowExpand([1, 3]);
    source.load();
    source.changeRowExpand([2, 4]);
    source.load();

    assert.equal(source.totalItemsCount(), 5);
    assert.deepEqual(source.items(), [{
        key: 1, items: [{ key: 2, items: null }, { key: 3, items: null }]
    }, {
        key: 2, isContinuationOnNextPage: true, items: [
            { key: 4, items: null },
            { key: 5, isContinuationOnNextPage: true, items: [this.array[6]] }
        ]
    }]);
});

QUnit.test("Collapse state of items restore after expand", function(assert) {
    var source = this.createDataSource({
        pageSize: 4
    });

    //act
    source.load();

    source.changeRowExpand([1, 3]);
    source.load();
    source.changeRowExpand([1]);
    source.load();
    source.changeRowExpand([1]);
    source.load();

    assert.equal(source.totalItemsCount(), 4);
    assert.deepEqual(source.items(), [{
        key: 1, items: [{
            key: 2, items: [
                { field1: 1, field2: 2, field3: 3 },
                { field1: 1, field2: 2, field3: 4 }
            ]
        }, { key: 3, items: null }
        ]
    }, {
        key: 2, items: [{
            key: 4, items: [
                { field1: 2, field2: 4, field3: 7 }
            ]
        }]
    }]);
});

QUnit.test("change sortOrder of group", function(assert) {
    var loadingChangedCount = 0;
    this.array.push({ field1: 3, field2: 5, field3: 8 });

    var source = this.createDataSource({
        pageSize: 4
    });

    //act
    source.load();
    source.changeRowExpand([1, 2]);
    source.load();
    source.group([{ selector: 'field1', desc: true }, 'field2']);

    source.loadingChanged.add(function() {
        loadingChangedCount++;
    });
    source.reload();

    //assert
    assert.equal(source.totalItemsCount(), 5);
    assert.deepEqual(source.items(), [{
        key: 3, items: [{
            key: 5, items: [{ field1: 3, field2: 5, field3: 8 }]
        }]
    }, {
        key: 2, items: [{
            key: 4, items: [{ field1: 2, field2: 4, field3: 7 }]
        }]
    }, {
        key: 1, isContinuationOnNextPage: true, items: [{
            key: 2, items: null
        }, {
            key: 3, isContinuationOnNextPage: true, items: [{ field1: 1, field2: 3, field3: 5 }]
        }
        ]
    }]);
    //T197066
    assert.equal(loadingChangedCount, 2, 'first - update collapsed group info, second - load data');
    assert.ok(!source.isLoading(), 'load completed');
});

QUnit.test("reset groups info when change group fields", function(assert) {
    this.array.push({ field1: 3, field2: 5, field3: 8 });

    var source = this.createDataSource({
        pageSize: 4
    });

    //act
    source.load();
    source.changeRowExpand([1, 2]);
    source.load();
    source.group(['field3', 'field2']);
    source.reload();

    assert.deepEqual(source.getGroupsInfo(), []);
});

QUnit.test("reset groups info when clear group fields", function(assert) {
    this.array.push({ field1: 3, field2: 5, field3: 8 });

    var source = this.createDataSource({
        pageSize: 4
    });

    //act
    source.load();
    source.changeRowExpand([1, 2]);
    source.load();
    source.group(null);
    source.reload();

    assert.deepEqual(source.getGroupsInfo(), []);
});

QUnit.test("clear second level groups info when change second level group field", function(assert) {
    this.array.push({ field1: 3, field2: 5, field3: 8 });

    var source = this.createDataSource({
        pageSize: 4
    });

    //act
    source.load();
    source.changeRowExpand([1, 2]);
    source.load();
    source.group(['field1', 'field3']);
    source.reload();

    assert.deepEqual(source.getGroupsInfo(), [
        {
            children: [],
            key: 1,
            offset: 0,
            data: {
                isExpanded: true,
                offset: 0,
                path: [1]
            }
        }
    ]);
});

QUnit.test("clear second level groups info when change change groups count to one", function(assert) {
    this.array.push({ field1: 3, field2: 5, field3: 8 });

    var source = this.createDataSource({
        pageSize: 4
    });

    //act
    source.load();
    source.changeRowExpand([1, 2]);
    source.load();
    source.group('field1');
    source.reload();

    assert.deepEqual(source.getGroupsInfo(), [
        {
            children: [],
            key: 1,
            offset: 0,
            data: {
                isExpanded: true,
                offset: 0,
                path: [1]
            }
        }
    ]);
});

//T307341
QUnit.test("Update group offset for expanded grouped row of the first level when change sortOrder of the first level group field", function(assert) {
    //arrange
    this.array = [
            { field1: 1, field2: 2, field3: 3 },
            { field1: 1, field2: 2, field3: 4 },
            { field1: 1, field2: 3, field3: 5 },
            { field1: 2, field2: 4, field3: 6 },
            { field1: 3, field2: 5, field3: 7 },
            { field1: 4, field2: 6, field3: 8 },
            { field1: 4, field2: 6, field3: 9 },
            { field1: 4, field2: 6, field3: 10 },
            { field1: 4, field2: 6, field3: 11 }
    ];

    var source = this.createDataSource({
        pageSize: 5
    });

    source.load();
    source.changeRowExpand([1, 2]);
    source.load();
    source.changeRowExpand([1, 3]);
    source.load();
    source.changeRowExpand([2]);
    source.load();
    source.changeRowExpand([3]);
    source.load();
    source.changeRowExpand([4]);
    source.load();

    //act
    source.group([{ selector: 'field1', desc: true, isExpanded: true }, { selector: 'field2', isExpanded: true }]);
    source.reload();
    window.test = source;
    //assert
    assert.equal(source.totalItemsCount(), 5);
    assert.deepEqual(source.items(), [{
        key: 4, items: null
    }, {
        key: 3, items: null
    }, {
        key: 2, items: null
    }, {
        key: 1, items: [{
            key: 2, items: null
        }, {
            key: 3, items: null
        }
        ]
    }]);
});

//T318433, T318206
QUnit.test("change filter after collapse second level group", function(assert) {
    var source = this.createDataSource({
        pageSize: 3
    });

    source.load();
    source.changeRowExpand([1, 2]);
    source.load();

    var loadArgs = [];
    source.store().on("loading", function(e) {
        loadArgs.push(e);
    });

    //act
    source.filter(["field1", ">=", 1]);
    source.load();

    //assert
    assert.equal(source.totalItemsCount(), 4);
    assert.deepEqual(source.items(), [{
        key: 1, items: [{
            key: 2, items: null
        }, {
            key: 3, items: [
                { field1: 1, field2: 3, field3: 5 },
                { field1: 1, field2: 3, field3: 6 }
            ]
        }
        ]
    }]);
    assert.equal(loadArgs.length, 3);
    assert.deepEqual(loadArgs[0].filter, [["field1", "=", 1], "and", ["field2", "=", 2], "and", ["field1", ">=", 1]]);
    assert.deepEqual(loadArgs[1].filter, [[["field1", "<", 1], "or", [["field1", "=", 1], "and", ["field2", "<", 2]]], "and", ["field1", ">=", 1]]);
    assert.deepEqual(loadArgs[2].filter, [[["field1", "<>", 1], "or", [["field1", "=", 1], "and", ["field2", "<>", 2]]], "and", ["field1", ">=", 1]]);
});

function createDataSourceWithRemoteGrouping(options, remoteGroupPaging, brokeOptions) {
    if($.isArray(options.store) || (options.store && options.store.type === "array") || options.load) {
        var arrayStore = new ArrayStore(options.store || []);
        options.executeAsync = options.executeAsync || function(func) { func(); };
        brokeOptions = brokeOptions || {};

        options.remoteOperations = { filtering: true, sorting: true, grouping: true, paging: true, summary: true };
        if(remoteGroupPaging) {
            options.remoteOperations.groupPaging = true;
        }
        delete options.store;
        options.load = options.load || function(loadOptions) {
            var d = $.Deferred();

            var removeDataItems = function(items, groupCount) {
                if(!groupCount) return;
                for(var i = 0; i < items.length; i++) {
                    if(groupCount > 1) {
                        removeDataItems(items[i].items, groupCount - 1);
                    } else {
                        items[i].count = items[i].items.length;
                        items[i].items = null;
                    }
                }
            };

            options.executeAsync(function() {
                arrayStore.load(loadOptions).done(function(data) {
                    var groupCount = gridCore.normalizeSortingInfo(loadOptions.group).length;

                    removeDataItems(data, groupCount);

                    arrayStore.totalCount(loadOptions).done(function(totalCount) {
                        var extra = {};
                        if(loadOptions.requireTotalCount && !brokeOptions.skipTotalCount) {
                            extra.totalCount = totalCount;
                        }
                        if(loadOptions.requireGroupCount && !brokeOptions.skipGroupCount) {
                            extra.groupCount = totalCount;
                        }
                        if(brokeOptions.useNativePromise) {
                            d.resolve($.extend({ data: data }, extra));
                        } else {
                            d.resolve(data, extra);
                        }
                    });
                });
            }, loadOptions);
            return d;
        };
    }
    return createDataSource(options);
}

QUnit.module("Remote group paging", {
    beforeEach: function() {
        this.array = [
            { field1: 1, field2: 2, field3: 3 },
            { field1: 1, field2: 2, field3: 4 },
            { field1: 1, field2: 3, field3: 5 },
            { field1: 2, field2: 4, field3: 6 },
            { field1: 2, field2: 4, field3: 7 },
            { field1: 1, field2: 5, field3: 7 }
        ];

        this.clock = sinon.useFakeTimers();

        var remoteGroupPaging = true;

        this.createDataSource = function(options, brokeOptions) {
            return createDataSourceWithRemoteGrouping($.extend({
                store: this.array,
                paginate: true,
                requireTotalCount: true,
                requireGroupCount: true
            }, options || {}), remoteGroupPaging, brokeOptions);
        };
    },
    afterEach: function() {
        this.clock.restore();
    }
});

QUnit.test("Load collapsed group", function(assert) {
    var dataSource = this.createDataSource({
            group: "field2",
            pageSize: 2
        }),
        loadingChanged = sinon.stub();

    dataSource.store().on("loading", loadingChanged);

    dataSource.load();

    assert.deepEqual(dataSource.items(), [{
        key: 2, items: null
    }, {
        key: 3, items: null
    }], "loaded items");

    assert.equal(dataSource.totalItemsCount(), 4, "total items count");
    assert.strictEqual(loadingChanged.callCount, 1);
    //assert.deepEqual(loadingChanged.lastCall.args[0].group, "field2");
    assert.strictEqual(loadingChanged.lastCall.args[0].requireTotalCount, true);
    assert.strictEqual(loadingChanged.lastCall.args[0].requireGroupCount, true);
    assert.strictEqual(loadingChanged.lastCall.args[0].skip, 0);
    assert.strictEqual(loadingChanged.lastCall.args[0].take, 2);

});

QUnit.test("Load collapsed group and expand first item", function(assert) {
    var dataSource = this.createDataSource({
            group: "field2",
            pageSize: 3
        }),
        loadingChanged = sinon.stub();

    dataSource.load();

    dataSource.store().on("loading", loadingChanged);

    dataSource.changeRowExpand([2]);

    dataSource.load();

    assert.deepEqual(dataSource.items(), [
        {
            key: 2,
            items: [{ "field1": 1, "field2": 2, "field3": 3 },
                { "field1": 1, "field2": 2, "field3": 4 }]
        }], "items");

    assert.equal(dataSource.totalItemsCount(), 6, "total items count");
    assert.strictEqual(loadingChanged.callCount, 2, "loading count");
    assert.deepEqual(loadingChanged.getCall(0).args[0].group, [{ "desc": false, "selector": "field2" }], "group by for second level loading");
    assert.strictEqual(loadingChanged.getCall(0).args[0].requireTotalCount, true, "require total count is passed on first loading");
    assert.strictEqual(loadingChanged.getCall(0).args[0].requireGroupCount, true, "require group count is passed on first loading");
    assert.strictEqual(loadingChanged.getCall(0).args[0].skip, 0, "skip for first level");
    assert.strictEqual(loadingChanged.getCall(0).args[0].take, 1, "take for first level");

    assert.deepEqual(loadingChanged.getCall(1).args[0].group, null, "group by for second level loading");
    assert.deepEqual(loadingChanged.getCall(1).args[0].filter, ["field2", "=", 2], "filter on second loading");
    assert.strictEqual(loadingChanged.getCall(1).args[0].requireTotalCount, false, "require total count is passed on second loading");
    assert.strictEqual(loadingChanged.getCall(1).args[0].requireGroupCount, false, "require group count is passed on first loading");
    assert.strictEqual(loadingChanged.getCall(1).args[0].skip, undefined, "skip for second level");
    assert.strictEqual(loadingChanged.getCall(1).args[0].take, 2, "take for second level");
});

//T511907
QUnit.test("Load collapsed group and expand group item that contain items with white space at the end", function(assert) {
    var loadStub = sinon.stub(),
        dataSource = this.createDataSource({
            load: loadStub,
            group: "name",
            pageSize: 3
        });

    loadStub.onCall(0).returns($.Deferred().resolve({ data: [
        { key: "test1", items: null, count: 3 },
        { key: "test2", items: null, count: 3 },
        { key: "test3", items: null, count: 3 }
    ], totalCount: 9, groupCount: 3 }));

    loadStub.onCall(1).returns($.Deferred().resolve({ data: [
        { key: "test1", items: null, count: 3 }
    ], totalCount: 9, groupCount: 3 }));

    loadStub.onCall(2).returns($.Deferred().resolve({ data: [
        { name: "test1", id: 1 },
        { name: "test1 ", id: 2 }
    ] }));

    dataSource.load();

    dataSource.changeRowExpand(["test1"]);

    //act
    dataSource.load();

    //assert
    assert.deepEqual(dataSource.items(), [
        {
            key: "test1",
            isContinuationOnNextPage: true,
            items: [
                { name: "test1", id: 1 },
                { name: "test1 ", id: 2 }
            ]
        }], "items");

    assert.equal(dataSource.totalItemsCount(), 7, "total items count");

    assert.strictEqual(loadStub.callCount, 3, "loading count");
    assert.deepEqual(loadStub.getCall(0).args[0].group, [{ "desc": false, "selector": "name" }], "load 0 group");
    assert.deepEqual(loadStub.getCall(1).args[0].group, [{ "desc": false, "selector": "name" }], "load 1 group");

    assert.deepEqual(loadStub.getCall(2).args[0].group, null, "load 2 group");
    assert.deepEqual(loadStub.getCall(2).args[0].filter, ["name", "=", "test1"], "load 2 filter");
    assert.strictEqual(loadStub.getCall(2).args[0].skip, undefined, "load 2 skip");
    assert.strictEqual(loadStub.getCall(2).args[0].take, 2, "load 2 skip");
});

QUnit.test("Load collapsed group and expand first item when native promise is used", function(assert) {
    var dataSource = this.createDataSource({
            group: "field2",
            pageSize: 3
        }, { useNativePromise: true }),
        loadingChanged = sinon.stub();

    dataSource.load();

    dataSource.store().on("loading", loadingChanged);

    dataSource.changeRowExpand([2]);

    dataSource.load();

    assert.deepEqual(dataSource.items(), [
        {
            key: 2,
            items: [{ "field1": 1, "field2": 2, "field3": 3 },
                { "field1": 1, "field2": 2, "field3": 4 }]
        }], "items");
});

QUnit.test("Send count query on row expand when next level is group", function(assert) {
    var dataSource = this.createDataSource({
            group: ["field2", "field1"],
            pageSize: 2
        }),
        loadingChanged = sinon.stub();

    dataSource.load();

    dataSource.store().on("loading", loadingChanged);

    dataSource.changeRowExpand([2]);

    assert.deepEqual(dataSource.items(), [{
        key: 2, items: null
    }, {
        key: 3, items: null
    }], "loaded items");

    assert.equal(dataSource.totalItemsCount(), 4, "total items count");
    assert.strictEqual(loadingChanged.callCount, 1, "loading count");

    assert.deepEqual(loadingChanged.getCall(0).args[0].group, [{ "desc": false, "selector": "field1" }], "group");
    assert.strictEqual(loadingChanged.getCall(0).args[0].requireTotalCount, false, "require total count is not passed on loading");
    assert.strictEqual(loadingChanged.getCall(0).args[0].requireGroupCount, true, "require group count is not passed on loading");
    assert.deepEqual(loadingChanged.getCall(0).args[0].filter, ["field2", "=", 2], "filter");
    assert.strictEqual(loadingChanged.getCall(0).args[0].skip, 0, "skip");
    assert.strictEqual(loadingChanged.getCall(0).args[0].take, 1, "take");
});

//T493778
QUnit.test("Send count query on row expand when next level is group if use native promises", function(assert) {
    var dataSource = this.createDataSource({
            group: ["field2", "field1"],
            pageSize: 2
        }, { useNativePromise: true }),
        loaded = sinon.stub();

    dataSource.load();

    dataSource.store().on("loaded", loaded);

    dataSource.changeRowExpand([2]);

    assert.deepEqual(dataSource.items(), [{
        key: 2, items: null
    }, {
        key: 3, items: null
    }], "loaded items");

    assert.equal(dataSource.totalItemsCount(), 4, "total items count");
    assert.strictEqual(loaded.callCount, 1, "loading count");

    assert.deepEqual(loaded.getCall(0).args[0], { data: [{ key: 1, items: null, count: 2 }], groupCount: 1, totalCount: undefined }, "loaded data");

    assert.deepEqual(loaded.getCall(0).args[1].group, [{ "desc": false, "selector": "field1" }], "group");
    assert.strictEqual(loaded.getCall(0).args[1].requireTotalCount, false, "require total count is not passed on loading");
    assert.strictEqual(loaded.getCall(0).args[1].requireGroupCount, true, "require group count is not passed on loading");
    assert.deepEqual(loaded.getCall(0).args[1].filter, ["field2", "=", 2], "filter");
    assert.strictEqual(loaded.getCall(0).args[1].skip, 0, "skip");
    assert.strictEqual(loaded.getCall(0).args[1].take, 1, "take");
});

QUnit.test("Load collapsed groups and expand first item when two groups", function(assert) {
    var dataSource = this.createDataSource({
            executeAsync: function(func, loadOptions) {
                setTimeout(func, 10);
            },
            group: ["field1", "field2"],
            pageSize: 3
        }),
        loadingChanged = sinon.stub();

    dataSource.summary({
        groupAggregates: [{
            summaryType: "count"
        }],
        totalAggregates: [{
            summaryType: "count"
        }]
    });

    dataSource.load();
    this.clock.tick(10);

    dataSource.changeRowExpand([1]);
    this.clock.tick(10);

    dataSource.store().on("loading", loadingChanged);

    dataSource.load();
    this.clock.tick(10);
    this.clock.tick(10);

    assert.deepEqual(dataSource.items(), [
        {
            isContinuationOnNextPage: true,
            key: 1,
            items: [{
                key: 2,
                items: null
            }, {
                key: 3,
                items: null
            }]
        }], "items");

    assert.equal(dataSource.totalItemsCount(), 6, "total items count");
    assert.strictEqual(loadingChanged.callCount, 2, "loading count");

    assert.deepEqual(loadingChanged.getCall(0).args[0].group, [{ "desc": false, "selector": "field1" }], "group by for second level loading");
    assert.strictEqual(loadingChanged.getCall(0).args[0].requireTotalCount, true, "require total count is passed on first loading");
    assert.strictEqual(loadingChanged.getCall(0).args[0].requireGroupCount, true, "require group count is passed on first loading");
    assert.strictEqual(loadingChanged.getCall(0).args[0].skip, 0, "skip for first level");
    assert.strictEqual(loadingChanged.getCall(0).args[0].take, 1, "take for first level");
    assert.deepEqual(loadingChanged.getCall(0).args[0].groupSummary, [{ summaryType: "count" }], "groupSummary for first loading");
    assert.deepEqual(loadingChanged.getCall(0).args[0].totalSummary, [{ summaryType: "count" }], "totalSummary for first loading");

    assert.deepEqual(loadingChanged.getCall(1).args[0].group, [{ "desc": false, "selector": "field2" }], "group by for second level loading");
    assert.deepEqual(loadingChanged.getCall(1).args[0].filter, ["field1", "=", 1], "filter on second loading");
    assert.strictEqual(loadingChanged.getCall(1).args[0].requireTotalCount, false, "require total count should not be passed on second loading");
    assert.strictEqual(loadingChanged.getCall(1).args[0].requireGroupCount, true, "require group count should not be passed on second loading");
    assert.strictEqual(loadingChanged.getCall(1).args[0].skip, 0, "skip for second level");
    assert.strictEqual(loadingChanged.getCall(1).args[0].take, 2, "take for second level");
    assert.deepEqual(loadingChanged.getCall(1).args[0].groupSummary, [{ summaryType: "count" }], "groupSummary for second loading");
    assert.deepEqual(loadingChanged.getCall(1).args[0].totalSummary, undefined, "no totalSummary for second loading");
});

QUnit.test("Load collapsed groups, expand second big item and go to third page when two groups", function(assert) {
    var array = [{ field1: 1, field2: 2, field3: 3 },
                    { field1: 2, field2: 3, field3: 4 },
                    { field1: 2, field2: 4, field3: 5 },
                    { field1: 2, field2: 5, field3: 6 },
                    { field1: 2, field2: 6, field3: 7 },
                    { field1: 2, field2: 7, field3: 8 },
                    { field1: 2, field2: 8, field3: 9 },
                    { field1: 3, field2: 9, field3: 10 }];

    var dataSource = this.createDataSource({
        store: array,
        group: ["field1", "field2"],
        pageSize: 3
    });

    dataSource.load();

    //act
    dataSource.changeRowExpand([2]);
    dataSource.load();

    dataSource.pageIndex(1);
    dataSource.load();

    dataSource.pageIndex(2);
    dataSource.load();

    //assert
    assert.deepEqual(dataSource.items(), [
        {
            isContinuation: true,
            isContinuationOnNextPage: true,
            key: 2,
            items: [{
                key: 6,
                items: null
            }, {
                key: 7,
                items: null
            }]
        }], "items");

    assert.equal(dataSource.totalItemsCount(), 12, "total items count");
});

QUnit.test("Load collapsed groups, expand second level item, expand third level big item and go to third page when two groups", function(assert) {
    var array = [{ field1: 1, field2: 2, field3: 3 },
                    { field1: 2, field2: 3, field3: 4 },
                    { field1: 2, field2: 4, field3: 5 },
                    { field1: 2, field2: 4, field3: 6 },
                    { field1: 2, field2: 4, field3: 7 },
                    { field1: 2, field2: 4, field3: 8 },
                    { field1: 2, field2: 4, field3: 9 },
                    { field1: 3, field2: 5, field3: 10 }];

    var dataSource = this.createDataSource({
        store: array,
        group: ["field1", "field2"],
        pageSize: 4
    });

    dataSource.load();

    //act
    dataSource.changeRowExpand([2]);
    dataSource.load();

    dataSource.changeRowExpand([2, 4]);
    dataSource.load();

    dataSource.pageIndex(1);
    dataSource.load();

    dataSource.pageIndex(2);
    dataSource.load();

    //assert
    assert.deepEqual(dataSource.items(), [
        {
            isContinuation: true,
            key: 2,
            items: [{
                key: 4,
                isContinuation: true,
                isContinuationOnNextPage: true,
                items: [array[4], array[5]]
            }]
        }], "items");

    assert.equal(dataSource.totalItemsCount(), 16, "total items count");
});

QUnit.test("Load collapsed groups and expand two items when two groups", function(assert) {
    var dataSource = this.createDataSource({
            group: ["field1", "field2"],
            pageSize: 5
        }),
        loadingChanged = sinon.stub();

    dataSource.load();

    dataSource.changeRowExpand([1]);
    dataSource.load();

    dataSource.changeRowExpand([2]);
    dataSource.store().on("loading", loadingChanged);
    dataSource.load();

    assert.deepEqual(dataSource.items(), [
        {
            key: 1,
            items: [{
                key: 2,
                items: null
            }, {
                key: 3,
                items: null
            },
            {
                key: 5,
                items: null
            }]
        }, {
            key: 2,
            isContinuationOnNextPage: true,
            items: []
        }], "items");

    assert.equal(dataSource.totalItemsCount(), 7, "total items count");
    assert.strictEqual(loadingChanged.callCount, 2, "loading count");

    assert.deepEqual(loadingChanged.getCall(0).args[0].group, [{ "desc": false, "selector": "field1" }], "group by for second level loading");
    assert.strictEqual(loadingChanged.getCall(0).args[0].requireTotalCount, true, "require total count is passed on first loading");
    assert.strictEqual(loadingChanged.getCall(0).args[0].requireGroupCount, true, "require group count is passed on first loading");
    assert.strictEqual(loadingChanged.getCall(0).args[0].skip, 0, "skip for first level");
    assert.strictEqual(loadingChanged.getCall(0).args[0].take, 2, "take for first level");

    assert.deepEqual(loadingChanged.getCall(1).args[0].group, [{ "desc": false, "selector": "field2" }], "group by for second level loading");
    assert.deepEqual(loadingChanged.getCall(1).args[0].filter, ["field1", "=", 1], "filter on second loading");
    assert.strictEqual(loadingChanged.getCall(1).args[0].requireTotalCount, false, "require total count should not be passed on second loading");
    assert.strictEqual(loadingChanged.getCall(1).args[0].requireGroupCount, true, "require group count should be passed on second loading");
    assert.strictEqual(loadingChanged.getCall(1).args[0].skip, 0, "skip for second level");
    assert.strictEqual(loadingChanged.getCall(1).args[0].take, undefined, "take for second level");
});

QUnit.test("Load collapsed group and expand second level item", function(assert) {
    var dataSource = this.createDataSource({
            group: ["field1", "field2"],
            pageSize: 3
        }),
        loadingChanged = sinon.stub();

    dataSource.load();

    dataSource.changeRowExpand([1]);
    dataSource.load();

    dataSource.changeRowExpand([1, 2]);

    dataSource.store().on("loading", loadingChanged);

    dataSource.load();

    assert.deepEqual(dataSource.items(), [
        {
            isContinuationOnNextPage: true,
            key: 1,
            items: [{
                key: 2,
                isContinuationOnNextPage: true,
                items: [
                    { "field1": 1, "field2": 2, "field3": 3 }
                ]
            }]
        }], "items");

    assert.equal(dataSource.totalItemsCount(), 10, "total items count"); //?
    assert.strictEqual(loadingChanged.callCount, 3, "loading count");

    assert.deepEqual(loadingChanged.getCall(0).args[0].group, [{ "desc": false, "selector": "field1" }], "group by for second level loading");
    assert.strictEqual(loadingChanged.getCall(0).args[0].requireTotalCount, true, "require total count is passed on first loading");
    assert.strictEqual(loadingChanged.getCall(0).args[0].skip, 0, "skip for first level");
    assert.strictEqual(loadingChanged.getCall(0).args[0].take, 1, "take for first level");

    assert.deepEqual(loadingChanged.getCall(1).args[0].group, [{ "desc": false, "selector": "field2" }], "group by for second level loading");
    assert.deepEqual(loadingChanged.getCall(1).args[0].filter, ["field1", "=", 1], "filter on second loading");
    assert.strictEqual(loadingChanged.getCall(1).args[0].requireTotalCount, false, "require total count is passed on second loading");
    assert.strictEqual(loadingChanged.getCall(1).args[0].skip, 0, "skip for second level");
    assert.strictEqual(loadingChanged.getCall(1).args[0].take, 1, "take for second level");

    assert.deepEqual(loadingChanged.getCall(2).args[0].group, null, "group by for second level loading");
    assert.deepEqual(loadingChanged.getCall(2).args[0].filter, [["field1", "=", 1], "and", ["field2", "=", 2]], "filter on second loading");
    assert.strictEqual(loadingChanged.getCall(2).args[0].requireTotalCount, false, "require total count is passed on second loading");
    assert.strictEqual(loadingChanged.getCall(2).args[0].skip, undefined, "skip for second level");
    assert.strictEqual(loadingChanged.getCall(2).args[0].take, 1, "take for second level");
});

//T452323
QUnit.test("Reload dataSource when one expanded group and two group levels exist", function(assert) {
    var dataSource = this.createDataSource({
            group: ["field1", "field2"],
            pageSize: 3
        }),
        loadingChanged = sinon.stub();

    dataSource.load();

    dataSource.changeRowExpand([1]);
    dataSource.load();

    dataSource.store().on("loading", loadingChanged);

    //act
    dataSource.reload(true);

    assert.deepEqual(dataSource.items(), [
        {
            isContinuationOnNextPage: true,
            key: 1,
            items: [{
                key: 2,
                items: null
            }, {
                key: 3,
                items: null
            }]
        }], "items");

    assert.equal(dataSource.totalItemsCount(), 6, "total items count");
    assert.strictEqual(loadingChanged.callCount, 4, "loading count");

    assert.deepEqual(loadingChanged.getCall(0).args[0].group, ["field2"], "group for group count request");
    assert.deepEqual(loadingChanged.getCall(0).args[0].filter, ["field1", "=", 1], "filter for group count request");
    assert.strictEqual(loadingChanged.getCall(0).args[0].requireTotalCount, false, "require total count is not passed for group count request");
    assert.strictEqual(loadingChanged.getCall(0).args[0].requireGroupCount, true, "require group count is passed for group count request");
    assert.strictEqual(loadingChanged.getCall(0).args[0].skip, 0, "skip for group count request");
    assert.strictEqual(loadingChanged.getCall(0).args[0].take, 1, "take for group count request");

    assert.deepEqual(loadingChanged.getCall(1).args[0].group, ["field1"], "group for group offset request"); //T452323, T477410
    assert.deepEqual(loadingChanged.getCall(1).args[0].filter, ["field1", "<", 1], "filter for group offset request");
    assert.strictEqual(loadingChanged.getCall(1).args[0].requireTotalCount, false, "require total count is not passed for group offset request");
    assert.strictEqual(loadingChanged.getCall(1).args[0].requireGroupCount, true, "require group count is passed for group offset request");
    assert.strictEqual(loadingChanged.getCall(1).args[0].skip, 0, "skip for group offset request");
    assert.strictEqual(loadingChanged.getCall(1).args[0].take, 1, "take for group offset request");

    assert.deepEqual(loadingChanged.getCall(2).args[0].group, [{ "desc": false, "selector": "field1" }], "group by for second level loading");
    assert.strictEqual(loadingChanged.getCall(2).args[0].requireTotalCount, true, "require total count is passed on first loading");
    assert.strictEqual(loadingChanged.getCall(2).args[0].requireGroupCount, true, "require group count is passed on first loading");
    assert.strictEqual(loadingChanged.getCall(2).args[0].skip, 0, "skip for first level");
    assert.strictEqual(loadingChanged.getCall(2).args[0].take, 1, "take for first level");

    assert.deepEqual(loadingChanged.getCall(3).args[0].group, [{ "desc": false, "selector": "field2" }], "group by for second level loading");
    assert.deepEqual(loadingChanged.getCall(3).args[0].filter, ["field1", "=", 1], "filter on second loading");
    assert.strictEqual(loadingChanged.getCall(3).args[0].requireTotalCount, false, "require total count should not be passed on second loading");
    assert.strictEqual(loadingChanged.getCall(3).args[0].requireGroupCount, true, "require group count should not be passed on second loading");
    assert.strictEqual(loadingChanged.getCall(3).args[0].skip, 0, "skip for second level");
    assert.strictEqual(loadingChanged.getCall(3).args[0].take, 2, "take for second level");
});

//T477410
QUnit.test("Reload dataSource when one expanded group and one group level exist", function(assert) {
    var dataSource = this.createDataSource({
            group: ["field1"],
            pageSize: 3
        }),
        loadingChanged = sinon.stub();

    dataSource.load();

    dataSource.changeRowExpand([1]);
    dataSource.load();

    dataSource.store().on("loading", loadingChanged);

    //act
    dataSource.reload(true);

    assert.deepEqual(dataSource.items(), [
        {
            isContinuationOnNextPage: true,
            key: 1,
            items: [
                { field1: 1, field2: 2, field3: 3 },
                { field1: 1, field2: 2, field3: 4 }
            ]
        }], "items");

    assert.equal(dataSource.totalItemsCount(), 7, "total items count");
    assert.strictEqual(loadingChanged.callCount, 4, "loading count");

    assert.deepEqual(loadingChanged.getCall(0).args[0].group, null, "group is empty for group count request");
    assert.deepEqual(loadingChanged.getCall(0).args[0].filter, ["field1", "=", 1], "filter for group count request");
    assert.strictEqual(loadingChanged.getCall(0).args[0].requireTotalCount, true, "require total count is not passed for group count request");
    assert.strictEqual(loadingChanged.getCall(0).args[0].requireGroupCount, false, "require group count is passed for group count request");
    assert.strictEqual(loadingChanged.getCall(0).args[0].skip, 0, "skip for group count request");
    assert.strictEqual(loadingChanged.getCall(0).args[0].take, 1, "take for group count request");

    assert.deepEqual(loadingChanged.getCall(1).args[0].group, ["field1"], "group for group offset request"); //T452323, T477410
    assert.deepEqual(loadingChanged.getCall(1).args[0].filter, ["field1", "<", 1], "filter for group offset request");
    assert.strictEqual(loadingChanged.getCall(1).args[0].requireTotalCount, false, "require total count is not passed for group offset request");
    assert.strictEqual(loadingChanged.getCall(1).args[0].requireGroupCount, true, "require group count is passed for group offset request");
    assert.strictEqual(loadingChanged.getCall(1).args[0].skip, 0, "skip for group offset request");
    assert.strictEqual(loadingChanged.getCall(1).args[0].take, 1, "take for group offset request");

    assert.deepEqual(loadingChanged.getCall(2).args[0].group, [{ "desc": false, "selector": "field1" }], "group by for second level loading");
    assert.strictEqual(loadingChanged.getCall(2).args[0].requireTotalCount, true, "require total count is passed on first loading");
    assert.strictEqual(loadingChanged.getCall(2).args[0].requireGroupCount, true, "require group count is passed on first loading");
    assert.strictEqual(loadingChanged.getCall(2).args[0].skip, 0, "skip for first level");
    assert.strictEqual(loadingChanged.getCall(2).args[0].take, 1, "take for first level");

    assert.deepEqual(loadingChanged.getCall(3).args[0].group, null, "group is empty for second level loading");
    assert.deepEqual(loadingChanged.getCall(3).args[0].filter, ["field1", "=", 1], "filter on second loading");
    assert.strictEqual(loadingChanged.getCall(3).args[0].requireTotalCount, false, "require total count should not be passed on second loading");
    assert.strictEqual(loadingChanged.getCall(3).args[0].requireGroupCount, false, "require group count should not be passed on second loading");
    assert.strictEqual(loadingChanged.getCall(3).args[0].skip, undefined, "skip for second level");
    assert.strictEqual(loadingChanged.getCall(3).args[0].take, 2, "take for second level");
});

//T454240
QUnit.test("Exception when store not returned groupCount", function(assert) {
    //arrange
    var dataSource = this.createDataSource({
        group: "field2"
    }, { skipGroupCount: true });

    //act
    try {
        dataSource.load();
        assert.ok(false, "exception should be rised");
    } catch(e) {
        assert.ok(e.message.indexOf("E4022") >= 0, "name of error");
    }
});

//T477410
QUnit.test("Exception when store not returned groupCount during expand not last level group", function(assert) {
    //arrange
    var brokeOptions = {};
    var dataSource = this.createDataSource({
        group: ["field1", "field2"]
    }, brokeOptions);

    dataSource.load();

    //act
    brokeOptions.skipGroupCount = true;

    try {
        dataSource.changeRowExpand([1]);
        assert.ok(false, "exception should be rised");
    } catch(e) {
        assert.ok(e.message.indexOf("E4022") >= 0, "name of error");
    }
});

//T477410
QUnit.test("Exception when store not returned totalCount after full reload", function(assert) {
    //arrange
    var brokeOptions = {};
    var dataSource = this.createDataSource({
        group: ["field1"]
    }, brokeOptions);

    dataSource.load();
    dataSource.changeRowExpand([1]);
    dataSource.load();

    //act
    try {
        brokeOptions.skipTotalCount = true;
        dataSource.reload(true);
        assert.ok(false, "exception should be rised");
    } catch(e) {
        assert.ok(e.message.indexOf("E4021") >= 0, "name of error");
    }
});

$.each(["Grouping without remoteOperations", "Grouping with remoteOperations", "Grouping with remoteOperations and with remote groupPaging"], function(moduleIndex, moduleName) {

    QUnit.module(moduleName, {
        beforeEach: function() {
            this.array = [
                { field1: 1, field2: 2, field3: 3 },
                { field1: 1, field2: 2, field3: 4 },
                { field1: 1, field2: 3, field3: 5 },
                { field1: 2, field2: 4, field3: 6 }
            ];
            var remoteGroupPaging = moduleIndex === 2;

            this.createDataSource = function(options) {
                return (moduleIndex === 0 ? createDataSource : createDataSourceWithRemoteGrouping)($.extend({
                    store: this.array,
                    paginate: true,
                    group: 'field2',
                    remoteOperations: false,
                    requireTotalCount: true
                }, options || {}), remoteGroupPaging);
            };
            this.processItems = function(items) {
                for(var i = 0; i < items.length; i++) {
                    if("key" in items[i]) {
                        delete items[i].count;
                        if(items[i].items) {
                            this.processItems(items[i].items);
                        }
                    }
                }
                return items;
            };
        }
    });

    if(moduleIndex === 1) {
        QUnit.test("grouping with paginate. Group is collapsed. Async loading", function(assert) {
            var clock = sinon.useFakeTimers(),
                changedCount = 0,
                source = this.createDataSource({
                    group: [{ selector: "field2", isExpanded: false }],
                    pageSize: 2,
                    executeAsync: function(func) {
                        setTimeout(function() {
                            func();
                        }, 10);
                    },
                    onChanged: function() {
                        changedCount++;
                    }
                });

            source.load();
            clock.tick(10);

            assert.equal(changedCount, 1);
            assert.equal(source.totalItemsCount(), 3);
            assert.deepEqual(this.processItems(source.items()), [{
                key: 2, items: null
            }, {
                key: 3, items: null
            }]);
            clock.restore();
        });

        QUnit.test("grouping with paginate. Group is expanded. Async loading", function(assert) {
            var clock = sinon.useFakeTimers(),
                loadArgs = [],
                changedCount = 0,
                source = this.createDataSource({
                    group: [{ selector: "field2", isExpanded: true }],
                    select: ["field2", "field3"],
                    pageSize: 3,
                    executeAsync: function(func, loadOptions) {
                        loadArgs.push(loadOptions);
                        setTimeout(function() {
                            func();
                        }, 10);
                    },
                    onChanged: function() {
                        changedCount++;
                    }
                });

            source.load();

            assert.equal(loadArgs.length, 1);

            //act
            clock.tick(10);

            //assert
            assert.equal(loadArgs.length, 2);

            assert.deepEqual(loadArgs[0].group, [{ selector: "field2", isExpanded: true }]);
            assert.deepEqual(loadArgs[0].select, ["field2", "field3"]);
            assert.deepEqual(loadArgs[0].filter, undefined);
            assert.strictEqual(loadArgs[0].skip, undefined);
            assert.strictEqual(loadArgs[0].take, undefined);

            assert.deepEqual(loadArgs[1].group, null);
            assert.deepEqual(loadArgs[1].select, ["field2", "field3"]); //T328457
            assert.deepEqual(loadArgs[1].filter, ["field2", "=", 2]);
            assert.strictEqual(loadArgs[1].skip, undefined);
            assert.strictEqual(loadArgs[1].take, 2);

            assert.equal(changedCount, 0);
            assert.equal(source.totalItemsCount(), -1);
            assert.deepEqual(this.processItems(source.items()), []);

            //act
            clock.tick(10);

            //assert
            assert.equal(changedCount, 1);
            assert.equal(source.totalItemsCount(), 8);
            assert.deepEqual(this.processItems(source.items()), [{
                key: 2, items: [
                    { field2: 2, field3: 3 },
                    { field2: 2, field3: 4 }
                ]
            }]);

            clock.restore();
        });
    }
    QUnit.test("grouping without paginate", function(assert) {
        var source = this.createDataSource({
            paginate: false
        });

        //act
        source.load();
        assert.equal(source.totalItemsCount(), 3);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 2, items: null
        }, {
            key: 3, items: null
        }, {
            key: 4, items: null
        }]);
        assert.equal(source.itemsCount(), 3);
    });

    QUnit.test("grouping with map function", function(assert) {
        var source = this.createDataSource({
            map: function(data) {
                return data;
            }
        });

        //act
        source.load();
        assert.equal(source.totalItemsCount(), 3);
        assert.deepEqual(source.items(), [{
            key: 2, items: null
        }, {
            key: 3, items: null
        }, {
            key: 4, items: null
        }]);
        assert.equal(source.itemsCount(), 3);
    });

    QUnit.test("grouping with pageSize more items count", function(assert) {
        var source = this.createDataSource();

        //act
        source.load();

        assert.equal(source.totalItemsCount(), 3);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 2, items: null
        }, {
            key: 3, items: null
        }, {
            key: 4, items: null
        }]);
        assert.equal(source.itemsCount(), 3);
    });

    QUnit.test("grouping with pageSize less items count", function(assert) {
        var source = this.createDataSource({
            pageSize: 2
        });

        //act
        source.load();

        assert.equal(source.totalItemsCount(), 3);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 2, items: null
        }, {
            key: 3, items: null
        }]);
        assert.equal(source.itemsCount(), 2);
    });

//T356413
    QUnit.test("grouping with pageSize less items count. Change pageSize at runtime", function(assert) {
        var source = this.createDataSource({
            group: "group",
            store: [
            { group: 1, id: 1 },
            { group: 1, id: 2 },
            { group: 1, id: 3 },
            { group: 1, id: 4 },
            { group: 1, id: 5 },
            { group: 1, id: 6 },
            { group: 2, id: 7 },
            ],
            pageSize: 3
        });

    //act
        source.load();

        source.changeRowExpand([1]);
        source.pageSize(5);
        source.load();

        source.pageSize(3);
        source.pageIndex(2);
        source.load();

    //assert
        assert.equal(source.totalItemsCount(), 10);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 1, isContinuation: true, items: [
            { group: 1, id: 5 },
            { group: 1, id: 6 },
            ]
        }]);
        assert.equal(source.itemsCount(), 3);
    });

    //B254928
    QUnit.test("grouping with pageSize less items count when no requireTotalCount", function(assert) {
        var source = this.createDataSource({
            pageSize: 5,
            group: [{ selector: 'field2', isExpanded: true }],
            requireTotalCount: false
        });

        //act
        source.load();

        //assert
        assert.equal(source.totalItemsCount(), 5);
        assert.equal(source.itemsCount(), 5);
        assert.ok(!source.isLastPage());
        assert.ok(!source.hasKnownLastPage());

        //act
        source.pageIndex(1);
        source.load();
        assert.equal(source.totalItemsCount(), 7);
        assert.equal(source.itemsCount(), 2);
        assert.ok(source.isLastPage());
        assert.ok(source.hasKnownLastPage());
    });

    //B239382
    QUnit.test("grouping with isExpanded group on previous page and isExpanded current group that continues on the next page", function(assert) {
        var source = this.createDataSource({
            pageSize: 4,
            store: [
                { field1: 1, field2: 2, field3: 3 },
                { field1: 1, field2: 2, field3: 4 },
                { field1: 1, field2: 3, field3: 5 },
                { field1: 2, field2: 4, field3: 6 },
                { field1: 2, field2: 5, field3: 7 },
                { field1: 2, field2: 5, field3: 8 },
                { field1: 2, field2: 5, field3: 9 },
                { field1: 2, field2: 6, field3: 10 },
                { field1: 2, field2: 6, field3: 11 }
            ],
            paginate: true,
            group: 'field2',
            remoteOperations: false,
            requireTotalCount: true
        });

        //act
        source.load();
        source.changeRowExpand([2]);
        source.load();
        source.pageIndex(1);
        source.load();
        source.changeRowExpand([5]);
        source.load();

        assert.equal(source.totalItemsCount(), 11);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 4,
            items: null
        }, {
            key: 5,
            isContinuationOnNextPage: true,
            items: [{ field1: 2, field2: 5, field3: 7 }, { field1: 2, field2: 5, field3: 8 }]
        }]);
        assert.equal(source.itemsCount(), 4);
    });

    //B239382
    QUnit.test("grouping on last page when group continued from several pages", function(assert) {
        var source = this.createDataSource({
            pageSize: 3,
            store: [
                { field1: 1, field2: 2, field3: 3 },
                { field1: 1, field2: 2, field3: 4 },
                { field1: 1, field2: 3, field3: 5 },
                { field1: 1, field2: 4, field3: 6 },
                { field1: 1, field2: 5, field3: 7 }
            ],
            paginate: true,
            group: 'field1',
            remoteOperations: false,
            requireTotalCount: true
        });

        //act
        source.load();
        var changeRowExpandResult = source.changeRowExpand([1]);
        source.load();
        source.pageIndex(2);
        source.load();

        assert.equal(source.totalItemsCount(), 8);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 1,
            isContinuation: true,
            items: [{ field1: 1, field2: 5, field3: 7 }]
        }]);
        assert.equal(source.itemsCount(), 2);
        assert.ok(changeRowExpandResult && changeRowExpandResult.done);
    });

    QUnit.test("grouping with pageSize less items count. Continue group parameter", function(assert) {
        var source = this.createDataSource({
            pageSize: 2
        });

        source.load();

        //act
        source.changeRowExpand([2]);
        source.pageIndex(1);
        source.load();

        assert.equal(source.totalItemsCount(), 6);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 2, isContinuation: true, items: [
                { field1: 1, field2: 2, field3: 4 }
            ]
        }]);
        assert.equal(source.itemsCount(), 2);
    });

    QUnit.test("grouping with pageSize less items count. Continue group parameter when sort exists and several groups expanded", function(assert) {
        var source = this.createDataSource({
            store: [
                { field1: 1, field2: 2, field3: 3 },
                { field1: 1, field2: 2, field3: 4 },
                { field1: 1, field2: 2, field3: 5 },
                { field1: 1, field2: 2, field3: 6 },
                { field1: 1, field2: 3, field3: 7 },
                { field1: 2, field2: 4, field3: 8 }
            ],
            group: "field2",
            sort: [{ selector: "field3", desc: true }],
            pageSize: 4
        });

        source.load();

        //act
        source.changeRowExpand([2]);
        source.load();
        source.pageIndex(1);
        source.load();
        source.changeRowExpand([3]);
        source.load();

        assert.equal(source.totalItemsCount(), 9);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 2, isContinuation: true, items: [
                { field1: 1, field2: 2, field3: 3 }
            ]
        }, {
            key: 3, items: [
                { field1: 1, field2: 3, field3: 7 }
            ]
        }]);
        assert.equal(source.itemsCount(), 4);
    });

    QUnit.test("grouping with pageSize less items count. Continue group parameter when virtual scrolling", function(assert) {
        var source = this.createDataSource({
            pageSize: 2,
            scrolling: { mode: 'virtual', preventPreload: true }
        });

        source.load();

        //act
        source.changeRowExpand([2]);
        source.pageIndex(1);
        source.load();

        assert.equal(source.totalItemsCount(), 5);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 2, isContinuation: true, items: [
                { field1: 1, field2: 2, field3: 4 }
            ]
        }, {
            key: 3, items: null
        }]);
        assert.equal(source.itemsCount(), 2);
    });

    QUnit.test("grouping with pageSize less items count. Continue on next page group parameter", function(assert) {
        var source = this.createDataSource({
            pageSize: 2
        });

        source.load();

        //act
        source.changeRowExpand([2]);
        source.load();

        assert.equal(source.totalItemsCount(), 6);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 2, isContinuationOnNextPage: true, items: [
                { field1: 1, field2: 2, field3: 3 }
            ]
        }]);
        assert.equal(source.itemsCount(), 2);
    });

    QUnit.test("grouping with pageSize less items count. Continue group parameter not set", function(assert) {
        var source = this.createDataSource({
            pageSize: 2,
            pageIndex: 1
        });
        source.load();

        //act
        assert.equal(source.totalItemsCount(), 3);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 4, items: null
        }]);
    });

    QUnit.test("grouping without paginate. Expand group", function(assert) {
        var source = this.createDataSource({
            paginate: false
        });

        source.load();
        source.changeRowExpand([2]);
        source.load();

        assert.equal(source.totalItemsCount(), 5);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 2, items: [
                { field1: 1, field2: 2, field3: 3 },
                { field1: 1, field2: 2, field3: 4 }
            ]
        }, {
            key: 3, items: null
        }, {
            key: 4, items: null
        }]);
    });

    QUnit.test("grouping without paginate. Collapse group after expand", function(assert) {
        var source = this.createDataSource({
            paginate: false
        });

        source.load();

        source.changeRowExpand([2]);
        source.changeRowExpand([2]);

        assert.equal(source.totalItemsCount(), 3);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 2, items: null
        }, {
            key: 3, items: null
        }, {
            key: 4, items: null
        }]);
    });


    QUnit.test("grouping with paginate. Expand group", function(assert) {
        var source = this.createDataSource({
            pageSize: 3
        });

        source.load();
        source.changeRowExpand([2]);
        source.load();

        assert.equal(source.totalItemsCount(), 5);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 2, items: [
                { field1: 1, field2: 2, field3: 3 },
                { field1: 1, field2: 2, field3: 4 }
            ]
        }]);
    });

    QUnit.test("grouping with pageSize less items count. Collapse group with undefined key", function(assert) {
        var source = this.createDataSource({
            group: [{ selector: 'field1', isExpanded: true, desc: true }],
            store: [
                { field1: false, field2: 1 },
                { field1: undefined, field2: 2 },
                { field1: true, field2: 3 }
            ],
            pageSize: 3
        });

        source.load();

        //act
        source.changeRowExpand([true]);
        source.load();
        source.changeRowExpand([undefined]);
        source.load();

        assert.deepEqual(this.processItems(source.items()), [
            { key: undefined, items: null },
            { key: true, items: null },
            { key: false, isContinuationOnNextPage: true, items: [] }
        ]);

        assert.equal(source.itemsCount(), 3);
    });

    QUnit.test("grouping with paginate. Collapse group after expand", function(assert) {
        var source = this.createDataSource({});

        source.load();

        source.changeRowExpand([2]);
        source.changeRowExpand([2]);

        assert.equal(source.totalItemsCount(), 3);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 2, items: null
        }, {
            key: 3, items: null
        }, {
            key: 4, items: null
        }]);
    });

    if(moduleIndex === 0) {

        QUnit.test("getContinuationGroupCount", function(assert) {
            assert.equal(getContinuationGroupCount(0, 3, 2), 1, '1 continuation groups');
            assert.equal(getContinuationGroupCount(0, 3, 3), 2, '2 continuation groups');
            assert.equal(getContinuationGroupCount(0, 3, 5), 3, '3 continuation groups');
            assert.equal(getContinuationGroupCount(0, 3, 6), 3, '3 continuation groups');
            assert.equal(getContinuationGroupCount(0, 3, 10), 5, '5 continuation groups');
            assert.equal(getContinuationGroupCount(0, 4, 10), 4, '4 continuation groups');

            assert.equal(getContinuationGroupCount(2, 3, 2), 1, '1 continuation groups');
            assert.equal(getContinuationGroupCount(2, 3, 3), 1, '1 continuation groups');
            assert.equal(getContinuationGroupCount(2, 3, 5), 2, '2 continuation groups');
            assert.equal(getContinuationGroupCount(2, 3, 10), 5, '5 continuation groups');

            assert.equal(getContinuationGroupCount(2, 3, 5), 2, '2 continuation groups');
            assert.equal(getContinuationGroupCount(2, 4, 5), 1, '1 continuation groups');
            assert.equal(getContinuationGroupCount(2, 6, 5), 1, '1 continuation groups');
            assert.equal(getContinuationGroupCount(2, 7, 5), 0, '0 continuation groups');


            assert.equal(getContinuationGroupCount(4, 3, 2), 0, '0 continuation groups');
            assert.equal(getContinuationGroupCount(4, 3, 3), 1, '1 continuation groups');
            assert.equal(getContinuationGroupCount(4, 3, 5), 2, '2 continuation groups');
            assert.equal(getContinuationGroupCount(4, 3, 10), 4, '4 continuation groups');

            assert.equal(getContinuationGroupCount(-2, 3, 2), 0, '0 continuation groups');
            assert.equal(getContinuationGroupCount(-2, 3, 3), 1, '1 continuation groups');
            assert.equal(getContinuationGroupCount(-2, 3, 5), 2, '2 continuation groups');
            assert.equal(getContinuationGroupCount(-2, 3, 10), 4, '4 continuation groups');
        });

        QUnit.test("collapseAll when no grouped columns", function(assert) {
            var source = this.createDataSource({
                pageSize: 2,
                group: null
            });
            source.load();

    //act
            source.collapseAll();
            source.load();

    //assert
            assert.equal(source.pageCount(), 2, "pageCount");
            assert.deepEqual(source.items(), [
        { field1: 1, field2: 2, field3: 3 },
        { field1: 1, field2: 2, field3: 4 }
            ], "items");
        });

//T112478
        QUnit.test("collapseAll for remote data", function(assert) {
    //arrange
            var source = this.createDataSource({
                    load: function() { return [{ group: "group 1", text: "text 1" }, { group: "group 1", text: "text 2" }, { group: "group 2", text: "text 3" }]; },
                    totalCount: function() { return -1; },
                    pageSize: 2,
                    group: "group",
                    remoteOperations: { filtering: true, sorting: true, paging: true }
                }),
                messageError;

            source.load();

            logger.error = function(message) {
                messageError = message;
            };

            assert.ok(source._grouping instanceof ExpandedGroupingHelper, "expanded grouping helper");


    //act
            source.collapseAll();
            source.load();

    //assert
            assert.ok(source._grouping instanceof CollapsedGroupingHelper, "collapsed grouping helper");
            assert.ok(!messageError, "no error");
            assert.deepEqual(this.processItems(source.items()), [{ key: "group 1", items: null }, { key: "group 2", items: null }]);
        });

        QUnit.test("expandAll when no grouped columns", function(assert) {
            var source = this.createDataSource({
                pageSize: 2,
                group: null
            });
            source.load();

    //act
            source.expandAll();
            source.load();

    //assert
            assert.equal(source.pageCount(), 2, "pageCount");
            assert.deepEqual(source.items(), [
        { field1: 1, field2: 2, field3: 3 },
        { field1: 1, field2: 2, field3: 4 }
            ], "items");
        });

//T183365
        QUnit.test("change grouping and reload with custom store", function(assert) {
            var source = this.createDataSource({
                load: function() {
                    return [
                { name: 'Chai', customer: 'John' },
                { name: 'Chang', customer: 'John' },
                { name: 'Queso Caprale', customer: 'Bob' }
                    ];
                },
                totalCount: function() { return 3; },
                group: null
            });
            source.load();

    //act
            source.group('name');
            source.reload();

    //assert
            assert.equal(source.totalItemsCount(), 3);
            assert.deepEqual(source.items(), [{
                key: 'Chai', items: null
            }, {
                key: 'Chang', items: null
            }, {
                key: 'Queso Caprale', items: null
            }]);
            assert.equal(source.itemsCount(), 3);
        });

//T266248
        QUnit.test("change sortOrder of group", function(assert) {
            var source = this.createDataSource({
                pageSize: 5,
                group: [{ selector: "field1", isExpanded: true }]
            });
            source.load();

    //act
            source.group([{ selector: "field1", isExpanded: true, desc: true }]);
            source.reload();

    //assert
            assert.equal(source.pageCount(), 2, "pageCount");
            assert.deepEqual(source.items(), [
                {
                    items: [{ field1: 2, field2: 4, field3: 6 }],
                    key: 2
                },
                {
                    isContinuationOnNextPage: true,
                    items: [
                { field1: 1, field2: 2, field3: 3 },
                { field1: 1, field2: 2, field3: 4 }
                    ],
                    key: 1
                }
            ], "items");
        });
    }
});


$.each(["Grouping without remoteOperations. Second level", "Grouping with remote grouping. Second level", "Grouping with remote grouping and remote group paging. Second level"], function(moduleIndex, moduleName) {

    QUnit.module(moduleName, {
        beforeEach: function() {
            this.array = [
                { field1: 1, field2: 2, field3: 3 },
                { field1: 1, field2: 2, field3: 4 },
                { field1: 1, field2: 3, field3: 5 },
                { field1: 1, field2: 3, field3: 6 },
                { field1: 2, field2: 4, field3: 7 }
            ];
            this.createDataSource = function(options) {
                var remoteGroupPaging = moduleIndex === 2;

                return (moduleIndex === 0 ? createDataSource : createDataSourceWithRemoteGrouping)($.extend({
                    store: this.array,
                    paginate: true,
                    remoteOperations: false,
                    group: ['field1', 'field2'],
                    requireTotalCount: true
                }, options || {}), remoteGroupPaging);
            };
            this.processItems = function(items) {
                for(var i = 0; i < items.length; i++) {
                    if("key" in items[i]) {
                        delete items[i].count;
                        if(items[i].items) {
                            this.processItems(items[i].items);
                        }
                    }
                }
                return items;
            };
        }
    });

    QUnit.test("grouping with paginate", function(assert) {
        var source = this.createDataSource({
            pageSize: 2
        });

        //act
        source.load();

        assert.equal(source.totalItemsCount(), 2);
        assert.deepEqual(source.items(), [{
            key: 1, items: null
        }, {
            key: 2, items: null
        }]);
    });

    QUnit.test("grouping with paginate. Expand first level group", function(assert) {
        var loadCount = 0,
            source = this.createDataSource({
                pageSize: 3,
                executeAsync: function(func) {
                    loadCount++;
                    func();
                }
            });

        source.load();
        loadCount = 0;

        //act
        source.changeRowExpand([1]);
        source.load();

        assert.equal(source.totalItemsCount(), 4);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 1, items: [
                { key: 2, items: null },
                { key: 3, items: null }
            ]
        }]);

        if(moduleIndex === 2) {
            assert.equal(loadCount, 3, "loading three times when remoteOperations with groupPaging is true");
        } else {
            assert.equal(loadCount, 0, "loading from cache when remoteOperations.groupPaging is false");
        }
    });

    QUnit.test("grouping with paginate. Expand first level group and second level group", function(assert) {
        var source = this.createDataSource({
            group: [{ selector: 'field1', desc: true, isExpanded: true }, { selector: 'field2', isExpanded: true }],
            pageSize: 5
        });

        //act
        source.load();
        source.changeRowExpand([2]);
        source.load();
        source.changeRowExpand([1, 2]);
        source.load();

        assert.equal(source.totalItemsCount(), 8);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 2, items: null
        }, {
            key: 1, items: [
                { key: 2, items: null },
                {
                    key: 3, items: [{ field1: 1, field2: 3, field3: 5 }], isContinuationOnNextPage: true
                }
            ]
        }]);
    });

    QUnit.test("grouping without paginate", function(assert) {
        var source = this.createDataSource({
            paginate: false
        });

        //act
        source.load();

        assert.equal(source.totalItemsCount(), 2);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 1, items: null
        }, {
            key: 2, items: null
        }]);
    });

    QUnit.test("grouping without paginate. Expand first level group", function(assert) {
        var source = this.createDataSource({
            paginate: false
        });

        //act
        source.load();
        source.changeRowExpand([1]);
        source.load();

        assert.equal(source.totalItemsCount(), 4);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 1, items: [
                { key: 2, items: null },
                { key: 3, items: null }
            ]
        }, {
            key: 2, items: null
        }]);
    });


    QUnit.test("Continue group parameter for first group level only", function(assert) {
        var source = this.createDataSource({
            pageSize: 2
        });

        //act
        source.load();
        source.changeRowExpand([1]);
        source.pageIndex(1);
        source.load();

        assert.equal(source.totalItemsCount(), 5);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 1, isContinuation: true, items: [{
                key: 3, items: null
            }]
        }]);
    });

    QUnit.test("Continue group parameter for first group level only when virtual scrolling", function(assert) {
        var source = this.createDataSource({
            pageSize: 2,
            scrolling: { mode: 'virtual', preventPreload: true }
        });

        //act
        source.load();
        source.changeRowExpand([1]);
        source.pageIndex(1);
        source.load();

        assert.equal(source.totalItemsCount(), 4);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 1, isContinuation: true, items: [{
                key: 3, items: null
            }]
        }, {
            key: 2, items: null
        }]);
    });

    QUnit.test("Continue group parameter for first group level only when page ends with group header", function(assert) {
        var source = this.createDataSource({
            pageSize: 2
        });

        //act
        source.load();
        source.changeRowExpand([2]);
        source.load();
        source.pageIndex(1);
        source.load();

        assert.equal(source.totalItemsCount(), 4);
        assert.equal(source.itemsCount(), 2);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 2, isContinuation: true, items: [{
                key: 4, items: null
            }]
        }]);
    });

    QUnit.test("Continue group parameter for both group levels", function(assert) {
        var source = this.createDataSource({
            pageSize: 3
        });

        //act
        source.load();
        source.changeRowExpand([1]);
        source.load();
        source.changeRowExpand([1, 2]);
        source.load();
        source.pageIndex(1);
        source.load();

        assert.equal(source.totalItemsCount(), 9);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 1, isContinuation: true, isContinuationOnNextPage: true, items: [
                { key: 2, isContinuation: true, items: [{ field1: 1, field2: 2, field3: 4 }] }
            ]
        }]);

        assert.equal(source.itemsCount(), 3);
    });

    QUnit.test("Continue group parameter for both group levels when virtual scrolling", function(assert) {
        var source = this.createDataSource({
            pageSize: 3,
            scrolling: { mode: 'virtual', preventPreload: true }
        });

        //act
        source.load();
        source.changeRowExpand([1]);
        source.load();
        source.changeRowExpand([1, 2]);
        source.load();
        source.pageIndex(1);
        source.load();

        assert.equal(source.totalItemsCount(), 6);
        assert.deepEqual(this.processItems(source.items()), [{
            isContinuationOnNextPage: true,
            items: [{
                isContinuationOnNextPage: true,
                items: [{ field1: 1, field2: 2, field3: 3 }],
                key: 2
            }
            ],
            key: 1
        },
        {
            key: 1, isContinuation: true, items: [
                { key: 2, isContinuation: true, items: [{ field1: 1, field2: 2, field3: 4 }] },
                { key: 3, items: null }
            ]
        }, {
            key: 2, items: null
        }]);
        assert.equal(source.itemsCount(), 6);
    });

    QUnit.test("Expand second level group", function(assert) {
        var source = this.createDataSource({
            pageSize: 5
        });

        //act
        source.load();

        source.changeRowExpand([1]);
        source.load();

        source.changeRowExpand([1, 3]);
        source.load();

        assert.equal(source.totalItemsCount(), 6);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 1, items: [{
                key: 2, items: null
            }, {
                key: 3, items: [
                    { field1: 1, field2: 3, field3: 5 },
                    { field1: 1, field2: 3, field3: 6 }
                ]
            }
            ]
        }]);
        assert.equal(source.itemsCount(), 5);
    });

    if(moduleIndex !== 2) {
        QUnit.test("Expand second level group ends on previous page", function(assert) {
            var source = this.createDataSource({
                pageSize: 5
            });

            source.load();

            //act
            source.changeRowExpand([1]);
            source.load();
            source.changeRowExpand([1, 3]);
            source.load();
            source.pageIndex(1);
            source.load();

            assert.equal(source.totalItemsCount(), 6);
            assert.deepEqual(this.processItems(source.items()), [{
                key: 2, items: null
            }]);
        });

        QUnit.test("Expand second level group ends on previous page when virtual scrolling", function(assert) {
            var source = this.createDataSource({
                pageSize: 5,
                scrolling: { mode: 'virtual', preventPreload: true }
            });

            source.load();

            //act
            source.changeRowExpand([1]);
            source.load();
            source.changeRowExpand([1, 3]);
            source.load();
            source.pageIndex(1);
            source.load();

            assert.equal(source.totalItemsCount(), 6);
            assert.deepEqual(this.processItems(source.items()), [{
                items: [{
                    items: null,
                    key: 2
                }, {
                    items: [
                            { field1: 1, field2: 3, field3: 5 },
                            { field1: 1, field2: 3, field3: 6 }
                    ],
                    key: 3
                }],
                key: 1
            }, {
                key: 2, items: null
            }]);
        });
    }

    QUnit.test("isExpanded state of items restore after collapse/expand", function(assert) {
        var source = this.createDataSource({
            pageSize: 5
        });

        //act
        source.load();

        source.changeRowExpand([1]);
        source.load();
        source.changeRowExpand([1, 3]);
        source.load();
        source.changeRowExpand([1]);
        source.load();
        source.changeRowExpand([1]);
        source.load();

        assert.equal(source.totalItemsCount(), 6);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 1, items: [{
                key: 2, items: null
            }, {
                key: 3, items: [
                    { field1: 1, field2: 3, field3: 5 },
                    { field1: 1, field2: 3, field3: 6 }
                ]
            }]
        }]);
    });

    QUnit.test("isExpanded all group levels", function(assert) {
        var source = this.createDataSource({
            pageSize: 3
        });

        source.expandAll();

        //act
        source.load();

        assert.equal(source.totalItemsCount(), 15);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 1, isContinuationOnNextPage: true, items:
            [
                    { key: 2, isContinuationOnNextPage: true, items: [{ field1: 1, field2: 2, field3: 3 }] }
            ]
        }]);
    });

    QUnit.test("isExpanded all first group level", function(assert) {
        var source = this.createDataSource({
            pageSize: 3
        });

        source.load();
        source.changeRowExpand([1]);
        source.load();
        source.changeRowExpand([1, 3]);
        source.load();
        source.changeRowExpand([1]);
        source.load();
        //act
        source.expandAll(0);
        source.load();

        assert.equal(source.totalItemsCount(), 11);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 1, items:
            [
                    { key: 2, items: null },
                    { key: 3, isContinuationOnNextPage: true, items: [] }
            ]
        }]);
    });

    QUnit.test("Collapsed all group levels", function(assert) {
        var source = this.createDataSource({
            pageSize: 3
        });

        source.load();
        source.changeRowExpand([1]);
        //act
        source.collapseAll();
        source.load();

        assert.equal(source.totalItemsCount(), 2);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 1, items: null
        }, {
            key: 2, items: null
        }]);
    });

    QUnit.test("Collapse all second group level", function(assert) {
        var source = this.createDataSource({
            pageSize: 3
        });

        source.load();
        source.changeRowExpand([1]);
        source.changeRowExpand([1, 3]);

        //act
        source.collapseAll(1);
        source.reload();

        //assert
        assert.ok(!source.group()[0].isExpanded);
        assert.ok(!source.group()[1].isExpanded);
        assert.equal(source.totalItemsCount(), 4);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 1, items:
            [
                    { key: 2, items: null },
                    { key: 3, items: null }
            ]
        }]);
    });

    QUnit.test("Collapse all second group level when all groups isExpanded", function(assert) {
        var source = this.createDataSource({
            pageSize: 3,
            group: [{ selector: 'field1', isExpanded: true }, { selector: 'field2', isExpanded: true }],
        });

        source.load();

        //act
        source.collapseAll(1);
        source.reload();

        //assert
        assert.ok(source.group()[0].isExpanded);
        assert.ok(!source.group()[1].isExpanded);
        assert.equal(source.totalItemsCount(), 5);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 1, items:
            [
                    { key: 2, items: null },
                    { key: 3, items: null }
            ]
        }]);
    });

    QUnit.test("isExpanded group parameter", function(assert) {
        var source = this.createDataSource({
            pageSize: 3,
            group: [{ selector: 'field1', isExpanded: true }, 'field2']
        });

        //act
        source.load();

        assert.equal(source.totalItemsCount(), 5);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 1, items:
            [
                    { key: 2, items: null },
                    { key: 3, items: null }
            ]
        }]);
    });

    //B254818
    QUnit.test("isExpanded group parameters. Apply filter", function(assert) {
        var source = this.createDataSource({
            pageSize: 5,
            group: [{ selector: 'field1', isExpanded: true }, { selector: 'field2', isExpanded: true }]
        });

        source.load();

        //act
        source.filter(['field2', '=', 2]);
        source.reload();

        assert.equal(source.totalItemsCount(), 4);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 1, items: [
                {
                    key: 2, items: [
                                { field1: 1, field2: 2, field3: 3 },
                                { field1: 1, field2: 2, field3: 4 }
                    ]
                }
            ]
        }]);
    });

    QUnit.test("change sortOrder for first group level", function(assert) {
        var source = this.createDataSource({
            pageSize: 3
        });

        //act
        source.load();
        source.changeRowExpand([1]);
        source.load();
        source.group([{ selector: 'field1', desc: true }, 'field2']);
        source.reload();

        assert.equal(source.totalItemsCount(), 5);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 2, items: null
        }, {
            key: 1, isContinuationOnNextPage: true, items: [{
                key: 2, items: null
            }]
        }]);
    });


    QUnit.test("change sortOrder for second group level", function(assert) {
        var source = this.createDataSource({
            pageSize: 3
        });

        //act
        source.load();
        source.changeRowExpand([1]);
        source.group([{ selector: 'field1' }, { selector: 'field2', desc: true }]);
        source.reload();

        assert.equal(source.totalItemsCount(), 4);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 1, items:
            [
                    { key: 3, items: null },
                    { key: 2, items: null }
            ]
        }]);
    });

//T382926
    QUnit.test("change sortOrder for second group level when all groups expanded", function(assert) {
        var array = [
            { field1: 1, field2: 2, field3: 1 },
            { field1: 1, field2: 2, field3: 2 },
            { field1: 1, field2: 2, field3: 3 },
            { field1: 1, field2: 2, field3: 4 },
            { field1: 2, field2: 1, field3: 5 },
            { field1: 2, field2: 1, field3: 6 },
            { field1: 2, field2: 2, field3: 7 }
        ];

        var source = this.createDataSource({
            store: array,
            pageSize: 5,
            group: [{ selector: 'field1', desc: false, isExpanded: true }, { selector: 'field2', desc: false, isExpanded: true }]
        });

    //act
        source.load();

        source.group([{ selector: 'field1', desc: false, isExpanded: true }, { selector: 'field2', desc: true, isExpanded: true }]);
        source.reload();

        assert.equal(source.totalItemsCount(), 18);
        assert.equal(source.itemsCount(), 5);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 1, items:
            [
                {
                    key: 2, isContinuationOnNextPage: true,
                    items: [array[0], array[1], array[2]]
                }
            ]
        }]);
    });

    //B254110
    QUnit.test("change isExpanded for first group level", function(assert) {
        var source = this.createDataSource({
            pageSize: 3
        });

        //act
        source.load();
        source.group([{ selector: 'field1', isExpanded: true }, 'field2']);
        source.reload();

        assert.equal(source.totalItemsCount(), 5);
        assert.deepEqual(this.processItems(source.items()), [{
            items: [{
                items: null,
                key: 2
            },
            {
                items: null,
                key: 3
            }
            ],
            key: 1
        }]);
    });

    //B254110
    QUnit.test("change isExpanded for second group level", function(assert) {
        var source = this.createDataSource({
            pageSize: 3,
            group: [{ selector: 'field1', isExpanded: true }, { selector: 'field2', isExpanded: true }]
        });

        //act
        source.load();
        source.group([{ selector: 'field1', isExpanded: true }, { selector: 'field2', isExpanded: false }]);
        source.reload();

        assert.equal(source.totalItemsCount(), 5);
        assert.deepEqual(this.processItems(source.items()), [{
            items: [{
                items: null,
                key: 2
            },
            {
                items: null,
                key: 3
            }
            ],
            key: 1
        }]);
    });

    QUnit.test("Second page for big group", function(assert) {
        var source = this.createDataSource({
            store: [
                { field1: 1, field2: 2, field3: 1 },
                { field1: 1, field2: 2, field3: 2 },
                { field1: 1, field2: 2, field3: 3 },
                { field1: 1, field2: 2, field3: 4 },
                { field1: 1, field2: 2, field3: 5 },
                { field1: 1, field2: 2, field3: 6 },
                { field1: 1, field2: 2, field3: 7 },
                { field1: 1, field2: 2, field3: 8 }
            ],
            pageSize: 5
        });

        source.load();

        //act
        source.expandAll();
        source.pageIndex(1);
        source.load();

        assert.equal(source.totalItemsCount(), 14);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 1,
            isContinuation: true,
            //isContinuationOnNextPage: true,
            items: [{
                key: 2,
                isContinuation: true,
                isContinuationOnNextPage: true,
                items: [
                    { field1: 1, field2: 2, field3: 4 },
                    { field1: 1, field2: 2, field3: 5 },
                    { field1: 1, field2: 2, field3: 6 }
                ]
            }]
        }]);
    });

    QUnit.test("Last pages for very big group", function(assert) {
        var array = [];
        var i;
        for(i = 0; i < 29; i++) {
            array.push({ field1: 1, field2: 2, field3: i + 1 });
        }
        array.push({ field1: 2, field2: 3, field3: 30 });
        var source = this.createDataSource({
            store: array,
            pageSize: 5
        });

        source.load();

        //act
        source.expandAll();
        source.pageIndex(8);
        source.load();

        assert.equal(source.totalItemsCount(), 53);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 1,
            isContinuation: true,
            //isContinuationOnNextPage: true,
            items: [{
                key: 2,
                isContinuation: true,
                isContinuationOnNextPage: true,
                items: [
                    { field1: 1, field2: 2, field3: 25 },
                    { field1: 1, field2: 2, field3: 26 },
                    { field1: 1, field2: 2, field3: 27 }
                ]
            }]
        }]);

        //act
        source.pageIndex(9);
        source.load();

        //assert
        assert.deepEqual(this.processItems(source.items()), [{
            key: 1,
            isContinuation: true,
            items: [{
                key: 2,
                isContinuation: true,
                items: [
                    { field1: 1, field2: 2, field3: 28 },
                    { field1: 1, field2: 2, field3: 29 }
                ]
            }]
        }, {
            key: 2,
            isContinuationOnNextPage: true,
            items: []
        }]);

        //act
        source.pageIndex(10);
        source.load();

        //assert
        assert.deepEqual(this.processItems(source.items()), [{
            key: 2,
            isContinuation: true,
            items: [{
                key: 3,
                items: [
                    { field1: 2, field2: 3, field3: 30 }
                ]
            }]
        }]);
    });

    QUnit.test("Third page for big group", function(assert) {
        var source = this.createDataSource({
            store: [
                { field1: 1, field2: 2, field3: 1 },
                { field1: 1, field2: 2, field3: 2 },
                { field1: 1, field2: 2, field3: 3 },
                { field1: 1, field2: 2, field3: 4 },
                { field1: 1, field2: 2, field3: 5 },
                { field1: 1, field2: 2, field3: 6 },
                { field1: 1, field2: 2, field3: 7 },
                { field1: 1, field2: 2, field3: 8 },
                { field1: 1, field2: 2, field3: 9 },
                { field1: 1, field2: 2, field3: 10 },
                { field1: 1, field2: 2, field3: 11 }
            ],
            pageSize: 5
        });

        source.load();

        //act
        source.expandAll();
        source.pageIndex(2);
        source.load();

        assert.equal(source.totalItemsCount(), 19);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 1,
            isContinuation: true,
            //isContinuationOnNextPage: true,
            items: [{
                key: 2,
                isContinuation: true,
                isContinuationOnNextPage: true,
                items: [
                    { field1: 1, field2: 2, field3: 7 },
                    { field1: 1, field2: 2, field3: 8 },
                    { field1: 1, field2: 2, field3: 9 }
                ]
            }]
        }]);
    });

    QUnit.test("Last page for big first level group", function(assert) {
        var source = this.createDataSource({
            store: [
                { field1: 1, field2: 2, field3: 1 },
                { field1: 1, field2: 2, field3: 2 },
                { field1: 1, field2: 2, field3: 3 },

                { field1: 1, field2: 2, field3: 4 },
                { field1: 1, field2: 2, field3: 5 },
                { field1: 1, field2: 2, field3: 6 },

                { field1: 1, field2: 2, field3: 7 },
                { field1: 1, field2: 2, field3: 8 },

                { field1: 2, field2: 3, field3: 9 }
            ],
            pageSize: 5
        });

        source.load();

        //act
        source.expandAll();
        source.pageIndex(2);
        source.load();

        assert.equal(source.totalItemsCount(), 18);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 1,
            isContinuation: true,
            items: [{
                key: 2,
                isContinuation: true,
                items: [
                    { field1: 1, field2: 2, field3: 7 },
                    { field1: 1, field2: 2, field3: 8 }
                ]
            }]
        }, {
            key: 2,
            isContinuationOnNextPage: true,
            items: []
        }]);
    });

    QUnit.test("Last page for big second level group", function(assert) {
        var source = this.createDataSource({
            store: [
                { field1: 1, field2: 2, field3: 1 },
                { field1: 1, field2: 2, field3: 2 },
                { field1: 1, field2: 2, field3: 3 },

                { field1: 1, field2: 2, field3: 4 },
                { field1: 1, field2: 2, field3: 5 },
                { field1: 1, field2: 2, field3: 6 },

                { field1: 1, field2: 2, field3: 7 },
                { field1: 1, field2: 2, field3: 8 },

                { field1: 1, field2: 3, field3: 9 }
            ],
            pageSize: 5
        });

        source.load();

        //act
        source.expandAll();
        source.pageIndex(2);
        source.load();

        assert.equal(source.totalItemsCount(), 18);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 1,
            isContinuation: true,
            items: [{
                key: 2,
                isContinuation: true,
                items: [
                    { field1: 1, field2: 2, field3: 7 },
                    { field1: 1, field2: 2, field3: 8 }
                ]
            }, {
                key: 3,
                isContinuationOnNextPage: true,
                items: []
            }]
        }]);
    });

    QUnit.test("Page ends with 2 group headers", function(assert) {
        var source = this.createDataSource({
            store: [
                { field1: 1, field2: 2, field3: 1 },
                { field1: 2, field2: 3, field3: 2 },
                { field1: 2, field2: 3, field3: 3 },
                { field1: 2, field2: 3, field3: 4 },
                { field1: 2, field2: 3, field3: 5 },
                { field1: 2, field2: 3, field3: 6 },
                { field1: 2, field2: 3, field3: 7 },
                { field1: 2, field2: 3, field3: 8 }
            ],
            pageSize: 5
        });

        source.load();

        //act
        source.expandAll();
        source.load();

        //assert
        assert.equal(source.totalItemsCount(), 18);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 1,
            items: [{
                key: 2,
                items: [
                    { field1: 1, field2: 2, field3: 1 }
                ]
            }]
        }, {
            key: 2,
            items: [{
                key: 3,
                isContinuationOnNextPage: true,
                items: []
            }]
        }]);

        //act
        source.pageIndex(1);
        source.load();

        //assert
        assert.equal(source.totalItemsCount(), 18);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 2,
            isContinuation: true,
            items: [{
                key: 3,
                isContinuation: true,
                isContinuationOnNextPage: true,
                items: [
                    { field1: 2, field2: 3, field3: 2 },
                    { field1: 2, field2: 3, field3: 3 },
                    { field1: 2, field2: 3, field3: 4 }
                ]
            }]
        }]);
    });

    QUnit.test("Page ends with 1 first group header", function(assert) {
        var source = this.createDataSource({
            store: [
                { field1: 1, field2: 2, field3: 1 },
                { field1: 1, field2: 2, field3: 2 },
                { field1: 2, field2: 3, field3: 3 },
                { field1: 2, field2: 3, field3: 4 },
                { field1: 2, field2: 3, field3: 5 },
                { field1: 2, field2: 3, field3: 6 },
                { field1: 2, field2: 3, field3: 7 },
                { field1: 2, field2: 3, field3: 8 }
            ],
            pageSize: 5
        });

        source.load();

        //act
        source.expandAll();
        source.load();

        //assert
        assert.equal(source.totalItemsCount(), 15);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 1,
            items: [{
                key: 2,
                items: [
                    { field1: 1, field2: 2, field3: 1 },
                    { field1: 1, field2: 2, field3: 2 }
                ]
            }]
        }, {
            key: 2,
            isContinuationOnNextPage: true,
            items: []
        }]);

        //act
        source.pageIndex(1);
        source.load();

        //assert
        assert.equal(source.totalItemsCount(), 15);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 2,
            isContinuation: true,
            items: [{
                key: 3,
                isContinuationOnNextPage: true,
                items: [
                    { field1: 2, field2: 3, field3: 3 },
                    { field1: 2, field2: 3, field3: 4 },
                    { field1: 2, field2: 3, field3: 5 }
                ]
            }]
        }]);
    });

    //T180076
    QUnit.test("Four groups with paging", function(assert) {
        var array = [
                { field1: 1, field2: 2, field3: 3, field4: 4, field5: 5 },
                { field1: 2, field2: 3, field3: 4, field4: 5, field5: 6 },
                { field1: 3, field2: 4, field3: 5, field4: 6, field5: 7 }
            ],
            source = this.createDataSource({
                group: [{ selector: 'field1', isExpanded: true }, { selector: 'field2', isExpanded: true }, { selector: 'field3', isExpanded: true }, { selector: 'field4', isExpanded: true }],
                store: array,
                pageSize: 10
            });

        //act
        source.pageIndex(1);
        source.load();

        assert.equal(source.totalItemsCount(), 15);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 3, items: [{
                key: 4, items: [{
                    key: 5, items: [{
                        key: 6, items: [array[2]]
                    }]
                }]
            }]
        }]);
    });

    //T180076
    QUnit.test("Four groups with paging after collapse group", function(assert) {
        var array = [
                { field1: 1, field2: 2, field3: 3, field4: 4, field5: 5 },
                { field1: 2, field2: 3, field3: 4, field4: 5, field5: 6 },
                { field1: 3, field2: 4, field3: 5, field4: 6, field5: 7 }
            ],
            source = this.createDataSource({
                group: [{ selector: 'field1', isExpanded: true }, { selector: 'field2', isExpanded: true }, { selector: 'field3', isExpanded: true }, { selector: 'field4', isExpanded: true }],
                store: array,
                pageSize: 10
            });

        //act
        source.pageIndex(1);
        source.load();
        source.changeRowExpand([1]);
        source.load();

        assert.equal(source.totalItemsCount(), 15);
        assert.deepEqual(this.processItems(source.items()), [{
            key: 3, isContinuation: true, items: [{
                key: 4, isContinuation: true, items: [{
                    key: 5, isContinuation: true, items: [{
                        key: 6, isContinuation: true, items: [array[2]]
                    }]
                }]
            }]
        }]);
    });
});
QUnit.module("Summary", {
    beforeEach: function() {
        this.createDataSource = function(options) {
            return createDataSource($.extend({
                store: TEN_NUMBERS,
                pageSize: 3,
                paginate: true,
                remoteOperations: 'auto',
                requireTotalCount: true
            }, options));
        };
    }
});

QUnit.test("Total summary without grouping", function(assert) {
    var dataSource = this.createDataSource({});

    dataSource.summary({
        totalAggregates: [{
            aggregator: "count"
        }, {
            aggregator: "sum"
        }]
    });

    //act
    dataSource.load();

    //assert
    assert.strictEqual(dataSource.items().length, 3);
    assert.deepEqual(dataSource.totalAggregates(), [10, 55]);
});

QUnit.test("Total summary and group summary", function(assert) {
    var dataSource = this.createDataSource({
        group: 'this'
    });

    dataSource.summary({
        totalAggregates: [{
            aggregator: "count"
        }, {
            aggregator: "sum"
        }],
        groupAggregates: [{
            aggregator: "count"
        }]
    });

    //act
    dataSource.load();

    //assert
    assert.strictEqual(dataSource.items().length, 3);
    assert.deepEqual(dataSource.items()[0], { key: 1, aggregates: [1], items: null });
    assert.deepEqual(dataSource.totalAggregates(), [10, 55]);
});

QUnit.test("Total summary and group summary when map defines", function(assert) {
    var dataSource = this.createDataSource({
        group: 'this',
        map: function(data) {
            return data;
        }
    });

    dataSource.summary({
        totalAggregates: [{
            aggregator: "count"
        }, {
            aggregator: "sum"
        }],
        groupAggregates: [{
            aggregator: "count"
        }]
    });

    //act
    dataSource.load();

    //assert
    assert.strictEqual(dataSource.items().length, 3);
    assert.deepEqual(dataSource.items()[0], { key: 1, aggregates: [1], items: null });
    assert.deepEqual(dataSource.totalAggregates(), [10, 55]);
});

QUnit.test("Total summary with CustomStore when remoteOperations filtering and sorting", function(assert) {
    var storeLoadOptions,
        dataSource = this.createDataSource({
            filter: ['this', '>=', 0],
            sort: 'this',
            store: new CustomStore({
                load: function(options) {
                    storeLoadOptions = options;
                    return TEN_NUMBERS;
                }
            }),
            remoteOperations: {
                filtering: true,
                sorting: true
            }
        });

    dataSource.summary({
        totalAggregates: [{
            aggregator: "count"
        }, {
            aggregator: "sum"
        }]
    });

    //act
    dataSource.load();

    //assert
    assert.ok(storeLoadOptions.filter);
    assert.ok(storeLoadOptions.sort);
    assert.strictEqual(dataSource.items().length, 3);
    assert.deepEqual(dataSource.totalAggregates(), [10, 55]);
});

QUnit.test("Total summary with CustomStore when remoteOperations false", function(assert) {
    var storeLoadOptions,
        dataSource = this.createDataSource({
            filter: ['this', '>=', 0],
            sort: 'this',
            store: new CustomStore({
                load: function(options) {
                    storeLoadOptions = options;
                    return TEN_NUMBERS;
                }
            }),
            remoteOperations: false
        });

    dataSource.summary({
        totalAggregates: [{
            aggregator: "count"
        }, {
            aggregator: "sum"
        }]
    });

    //act
    dataSource.load();

    //assert
    assert.ok(!storeLoadOptions.filter);
    assert.ok(!storeLoadOptions.sort);
    assert.strictEqual(dataSource.items().length, 3);
    assert.deepEqual(dataSource.totalAggregates(), [10, 55]);
});

QUnit.test("Total summary and group summary with CustomStore", function(assert) {
    var dataSource = this.createDataSource({
        group: "this",
        remoteOperations: false,
        store: new CustomStore({
            load: function() {
                return TEN_NUMBERS;
            }
        })
    });

    dataSource.summary({
        totalAggregates: [{
            aggregator: "count"
        }, {
            aggregator: "sum"
        }],
        groupAggregates: [{
            aggregator: "count"
        }]
    });

    //act
    dataSource.load();

    //assert
    assert.strictEqual(dataSource.items().length, 3);
    assert.deepEqual(dataSource.items()[0], { key: 1, aggregates: [1], items: null });
    assert.deepEqual(dataSource.totalAggregates(), [10, 55]);
});

QUnit.module("Cache", {
    beforeEach: function() {
        this.createDataSource = function(options) {
            var that = this;
            that.loadingCount = 0;
            return createDataSource($.extend({
                store: {
                    onLoading: function() {
                        that.loadingCount++;
                    },
                    type: "array",
                    data: TEN_NUMBERS
                },
                pageSize: 3,
                paginate: true,
                remoteOperations: false,
                requireTotalCount: true
            }, options));
        };
    }
});

QUnit.test("no caching when all remoteOperations", function(assert) {
    var dataSource = this.createDataSource({
        remoteOperations: {
            filtering: true,
            sorting: true,
            paging: true
        }
    });
    dataSource.load();

    //act
    dataSource.load();
    dataSource.reload();

    //assert
    assert.deepEqual(this.loadingCount, 3, "three loading");
});

QUnit.test("no caching when cacheEnabled false", function(assert) {
    var dataSource = this.createDataSource({
        cacheEnabled: false
    });
    dataSource.load();

    //act
    dataSource.load();
    dataSource.reload();

    //assert
    assert.deepEqual(this.loadingCount, 3, "three loading");
});

QUnit.test("second load from cache after change filter/sort", function(assert) {
    var dataSource = this.createDataSource({});
    dataSource.load();

    //act
    dataSource.sort({ selector: "this", desc: true });
    dataSource.filter(["this", ">", 5]);
    dataSource.load();

    //assert
    assert.strictEqual(dataSource.items().length, 3, "item Count");
    assert.strictEqual(dataSource.items()[0], 10, "first item");
    assert.deepEqual(dataSource.totalCount(), 5, "totalCount");
    assert.deepEqual(this.loadingCount, 1, "one loading");
});

QUnit.test("full reload reset cache", function(assert) {
    var dataSource = this.createDataSource({});
    dataSource.load();

    //act
    dataSource.filter(["this", ">", 5]);
    dataSource.reload(true);

    //assert
    assert.deepEqual(dataSource.totalCount(), 5, "totalCount");
    assert.deepEqual(this.loadingCount, 2, "two loading");
});

QUnit.test("reload from original dataSource reset cache", function(assert) {
    var dataSource = this.createDataSource({});
    dataSource.load();

    //act
    dataSource.filter(["this", ">", 5]);
    dataSource._dataSource.reload();

    //assert
    assert.deepEqual(dataSource.totalCount(), 5, "totalCount");
    assert.deepEqual(this.loadingCount, 2, "two loading");
});

QUnit.test("load from cache when remote filtering is not changed and pageIndex is changed", function(assert) {
    var dataSource = this.createDataSource({
        remoteOperations: {
            filtering: true
        }
    });
    dataSource.filter(["this", "<", 5]);
    dataSource.load();

    //act
    dataSource.filter(["this", "<", 5]);
    dataSource.pageIndex(1);
    dataSource.load();

    //assert
    assert.deepEqual(dataSource.items()[0], 4, "first item on page");
    assert.deepEqual(this.loadingCount, 1, "one loading");
});

QUnit.test("load from cache when pageSize and pageIndex is changed", function(assert) {
    var dataSource = this.createDataSource({
        remoteOperations: {
            filtering: true
        }
    });
    dataSource.load();

    //act
    dataSource.pageSize(4);
    dataSource.pageIndex(1);
    dataSource.reload();

    //assert
    assert.deepEqual(dataSource.items()[0], 5, "first item on page");
    assert.deepEqual(this.loadingCount, 1, "one loading");
});

//T328467
QUnit.test("load from cache when remote paging but summary exists and pageIndex is changed", function(assert) {
    var dataSource = this.createDataSource({
        remoteOperations: {
            filtering: true,
            paging: true
        }
    });

    dataSource.summary({
        totalAggregates: [{
            selector: "this",
            aggregator: "count"
        }, {
            selector: "this",
            aggregator: "sum"
        }]
    });

    dataSource.load();
    assert.deepEqual(this.loadingCount, 1, "one loading");

    //act
    dataSource.pageSize(4);
    dataSource.pageIndex(1);
    dataSource.reload();

    //assert
    assert.deepEqual(dataSource.items()[0], 5, "first item on page");
    assert.deepEqual(this.loadingCount, 1, "one loading");
    assert.deepEqual(dataSource.totalAggregates(), [10, 55], "total aggregates");
});


QUnit.test("reset cache when remote filtering is changed", function(assert) {
    var dataSource = this.createDataSource({
        remoteOperations: {
            filtering: true
        }
    });
    dataSource.filter(["this", ">", 5]);
    dataSource.load();

    //act
    dataSource.filter(["this", ">", 6]);
    dataSource.reload();

    //assert
    assert.deepEqual(dataSource.items()[0], 7, "first item on page");
    assert.deepEqual(dataSource.totalCount(), 4, "totalCount");
    assert.deepEqual(this.loadingCount, 2, "one loading");
});

QUnit.test("reset cache when remote sorting is changed", function(assert) {
    var dataSource = this.createDataSource({
        remoteOperations: {
            sorting: true
        }
    });
    dataSource.load();

    //act
    dataSource.sort({ selector: "this", desc: true });
    dataSource.reload();

    //assert
    assert.deepEqual(dataSource.items()[0], 10, "first item on page");
    assert.deepEqual(dataSource.totalCount(), 10, "totalCount");
    assert.deepEqual(this.loadingCount, 2, "one loading");
});

QUnit.test("reset cache when remote sorting is not changed and grouping is changed", function(assert) {
    var dataSource = this.createDataSource({
        remoteOperations: {
            sorting: true
        }
    });
    dataSource.load();

    //act
    dataSource.group({ selector: "this", desc: true });
    dataSource.reload();

    //assert
    assert.deepEqual(dataSource.items()[0], { key: 10, items: null }, "first item on page");
    assert.deepEqual(dataSource.totalCount(), 10, "totalCount");
    assert.deepEqual(this.loadingCount, 1, "one loading");
});

QUnit.module("Custom Load", {
    beforeEach: function() {
        this.clock = sinon.useFakeTimers();
        this.createDataSource = function(options) {
            var that = this;
            that.loadingCount = 0;
            return (options.remoteOperations === true ? createDataSourceWithRemoteGrouping : createDataSource)($.extend({
                store: {
                    onLoading: function(e) {
                        if(e.group && e.group.length === 1 && e.group[0].selector === "this" && e.group[0].groupInterval) {
                            e.group[0].selector = function(data) {
                                return Math.floor(data / e.group[0].groupInterval);
                            };
                        }
                        that.loadingCount++;
                    },
                    type: "array",
                    data: TEN_NUMBERS
                },
                pageSize: 3,
                paginate: true,
                remoteOperations: false,
                requireTotalCount: true
            }, options));
        };
    },
    afterEach: function() {
        this.clock.restore();
    }
});

//T344031
QUnit.test("load when loadingTimeout is defined", function(assert) {
    var dataSource = this.createDataSource({
        loadingTimeout: 10
    });
    dataSource.load();

    this.clock.tick(10);


    var changedArgs = [];
    var loadingChangedArgs = [];

    dataSource.changed.add(function(e) {
        changedArgs.push(e);
    });

    dataSource.loadingChanged.add(function(e) {
        loadingChangedArgs.push(e);
    });

    var customLoadData = false;

    //act
    dataSource.load({
        filter: ["this", ">", 8]
    }).done(function(data) {
        customLoadData = data;
    });

    this.clock.tick(9);

    //assert
    assert.ok(!customLoadData, "custom load data is not loaded");
    assert.deepEqual(loadingChangedArgs, [true], "loadingChanged args when data is not loaded");

    //act
    this.clock.tick(1);

    //assert
    assert.deepEqual(customLoadData, [9, 10], "custom load data");
    assert.deepEqual(loadingChangedArgs, [true, false], "loadingChanged args");
});

QUnit.test("load without cache with group/filter/paging options", function(assert) {
    var dataSource = this.createDataSource({
        filter: ["this", ">", "5"],
        remoteOperations: { filtering: true }
    });
    dataSource.load();

    var changedArgs = [];
    var loadingChangedArgs = [];

    dataSource.changed.add(function(e) {
        changedArgs.push(e);
    });

    dataSource.loadingChanged.add(function(e) {
        loadingChangedArgs.push(e);
    });

    var customLoadData = false;

    //act
    dataSource.load({
        filter: ["this", ">", "1"],
        group: "this",
        skip: 2,
        take: 2
    }).done(function(data) {
        customLoadData = data;
    });


    //assert
    assert.deepEqual(customLoadData, [{ key: 4, items: [4] }, { key: 5, items: [5] }], "custom load data");
    assert.ok(!changedArgs.length, "changed is not fired");
    assert.deepEqual(loadingChangedArgs, [true, false], "loadingChanged args");

    assert.deepEqual(dataSource.items(), [6, 7, 8], "items on page");
    assert.deepEqual(dataSource.totalCount(), 5, "totalCount");
    assert.deepEqual(this.loadingCount, 2, "loading count");
});

//T317818
QUnit.test("load from cache with group/filter/paging options", function(assert) {
    var dataSource = this.createDataSource({
        filter: ["this", ">", "5"],
        remoteOperations: { filtering: true }
    });
    dataSource.load();

    var changedArgs = [];
    var loadingChangedArgs = [];

    dataSource.changed.add(function(e) {
        changedArgs.push(e);
    });

    dataSource.loadingChanged.add(function(e) {
        loadingChangedArgs.push(e);
    });

    var customLoadData = false;

    //act
    dataSource.load({
        filter: ["this", ">", "5"],
        group: "this",
        skip: 2,
        take: 2
    }).done(function(data) {
        customLoadData = data;
    });


    //assert
    assert.deepEqual(customLoadData, [{ key: 8, items: [8] }, { key: 9, items: [9] }], "custom load data");
    assert.ok(!changedArgs.length, "changed is not fired");
    assert.deepEqual(loadingChangedArgs, [true, false], "loadingChanged args");

    assert.deepEqual(dataSource.items(), [6, 7, 8], "items on page");
    assert.deepEqual(dataSource.totalCount(), 5, "totalCount");
    assert.deepEqual(this.loadingCount, 1, "loading count");
});

//T341843
QUnit.test("load from cache with group as function options", function(assert) {
    var dataSource = this.createDataSource({
        group: [{ selector: "this", desc: false }],
        remoteOperations: false
    });
    dataSource.load();

    var changedArgs = [];
    var loadingChangedArgs = [];

    dataSource.changed.add(function(e) {
        changedArgs.push(e);
    });

    dataSource.loadingChanged.add(function(e) {
        loadingChangedArgs.push(e);
    });

    var customLoadData = false;

    //act
    dataSource.load({
        group: function(data) { return data % 2; }
    }).done(function(data) {
        customLoadData = data;
    });


    //assert
    assert.deepEqual(customLoadData, [{ key: 0, items: [2, 4, 6, 8, 10] }, { key: 1, items: [1, 3, 5, 7, 9] }], "custom load data");
    assert.ok(!changedArgs.length, "changed is not fired");
    assert.deepEqual(loadingChangedArgs, [true, false], "loadingChanged args");

    assert.deepEqual(dataSource.items(), [{ key: 1, items: null }, { key: 2, items: null }, { key: 3, items: null }], "items on page");
    assert.deepEqual(dataSource.totalCount(), 10, "totalCount");
    assert.deepEqual(this.loadingCount, 1, "loading count");
});

QUnit.test("load when remote grouping and not isLoadingAll", function(assert) {
    var dataSource = this.createDataSource({
        filter: ["this", ">", "5"],
        remoteOperations: true
    });
    dataSource.load();

    var changedArgs = [];
    var loadingChangedArgs = [];

    dataSource.changed.add(function(e) {
        changedArgs.push(e);
    });

    dataSource.loadingChanged.add(function(e) {
        loadingChangedArgs.push(e);
    });

    var customLoadData = false;
    this.loadingCount = 0;
    //act
    dataSource.load({
        filter: ["this", ">", "5"],
        group: "this",
        skip: 2,
        take: 2
    }).done(function(data) {
        customLoadData = data;
    });


    //assert
    assert.deepEqual(customLoadData, [{ key: 8, items: null, count: 1 }, { key: 9, items: null, count: 1 }], "custom load data");
    assert.ok(!changedArgs.length, "changed is not fired");
    assert.deepEqual(loadingChangedArgs, [true, false], "loadingChanged args");

    assert.deepEqual(dataSource.items(), [6, 7, 8], "items on page");
    assert.deepEqual(dataSource.totalCount(), 5, "totalCount");
    assert.deepEqual(this.loadingCount, 1, "loading count");
});

//T368828
QUnit.test("load when remote grouping and first page", function(assert) {
    var dataSource = this.createDataSource({
        group: "this",
        remoteOperations: true,
        pageSize: 3
    });
    dataSource.load();

    var changedArgs = [];
    var loadingChangedArgs = [];

    dataSource.changed.add(function(e) {
        changedArgs.push(e);
    });

    dataSource.loadingChanged.add(function(e) {
        loadingChangedArgs.push(e);
    });

    var customLoadData = false;
    this.loadingCount = 0;
    //act
    dataSource.load({
        group: "this",
        skip: 0,
        take: 3
    }).done(function(data) {
        customLoadData = data;
    });


    //assert
    assert.deepEqual(customLoadData, [{ key: 1, items: null, count: 1 }, { key: 2, items: null, count: 1 }, { key: 3, items: null, count: 1 }], "custom load data");
    assert.ok(!changedArgs.length, "changed is not fired");
    assert.deepEqual(loadingChangedArgs, [true, false], "loadingChanged args");

    assert.deepEqual(dataSource.items(), [{ key: 1, items: null }, { key: 2, items: null }, { key: 3, items: null }], "items on page");
    assert.deepEqual(dataSource.totalCount(), 10, "totalCount");
    assert.deepEqual(this.loadingCount, 0, "loading count");
});

//T368828
QUnit.test("load when remote grouping and second page", function(assert) {
    var dataSource = this.createDataSource({
        group: "this",
        remoteOperations: true
    });
    dataSource.load();

    var changedArgs = [];
    var loadingChangedArgs = [];

    dataSource.changed.add(function(e) {
        changedArgs.push(e);
    });

    dataSource.loadingChanged.add(function(e) {
        loadingChangedArgs.push(e);
    });

    var customLoadData = false;
    this.loadingCount = 0;
    //act

    dataSource.load({
        group: "this",
        skip: 2,
        take: 2
    }).done(function(data) {
        customLoadData = data;
    });


    //assert
    assert.deepEqual(customLoadData, [{ key: 3, items: null, count: 1 }, { key: 4, items: null, count: 1 }], "custom load data");
    assert.ok(!changedArgs.length, "changed is not fired");
    assert.deepEqual(loadingChangedArgs, [true, false], "loadingChanged args");

    assert.deepEqual(dataSource.items(), [{ key: 1, items: null }, { key: 2, items: null }, { key: 3, items: null }], "items on page");
    assert.deepEqual(dataSource.totalCount(), 10, "totalCount");
    assert.deepEqual(this.loadingCount, 1, "loading count");
});

//T368875
QUnit.test("load when remote grouping and groupInterval is defined", function(assert) {
    var dataSource = this.createDataSource({
        group: "this",
        remoteOperations: true,
        pageSize: 3
    });
    dataSource.load();

    var changedArgs = [];
    var loadingChangedArgs = [];

    dataSource.changed.add(function(e) {
        changedArgs.push(e);
    });

    dataSource.loadingChanged.add(function(e) {
        loadingChangedArgs.push(e);
    });

    var customLoadData = false;
    this.loadingCount = 0;
    //act
    dataSource.load({
        group: [{ selector: "this", groupInterval: 2 }],
        skip: 0,
        take: 3
    }).done(function(data) {
        customLoadData = data;
    });


    //assert
    assert.deepEqual(customLoadData, [{ key: 0, items: null, count: 1 }, { key: 1, items: null, count: 2 }, { key: 2, items: null, count: 2 }], "custom load data");
    assert.ok(!changedArgs.length, "changed is not fired");
    assert.deepEqual(loadingChangedArgs, [true, false], "loadingChanged args");

    assert.deepEqual(dataSource.items(), [{ key: 1, items: null }, { key: 2, items: null }, { key: 3, items: null }], "items on page");
    assert.deepEqual(dataSource.totalCount(), 10, "totalCount");
    assert.deepEqual(this.loadingCount, 1, "loading count");
});

//T375388
QUnit.test("load when remote summary and summary is not defined", function(assert) {
    var dataSource = this.createDataSource({
        remoteOperations: { summary: true }
    });
    dataSource.load();

    var customLoadData = false;
    //act
    dataSource.load({
        filter: ["this", ">=", "5"],
        group: "this",
        take: 2
    }).done(function(data) {
        customLoadData = data;
    });


    //assert
    assert.deepEqual(customLoadData, [{ key: 5, items: [5] }, { key: 6, items: [6] }], "custom load data");

    assert.deepEqual(dataSource.items(), [1, 2, 3], "items on page");
    assert.deepEqual(dataSource.totalCount(), 10, "totalCount");
});

//T344271
QUnit.test("load when remote grouping and not isLoadingAll and expand one item", function(assert) {
    var dataSource = this.createDataSource({
        filter: ["this", ">", "5"],
        remoteOperations: true,
        group: "this"
    });
    dataSource.load();

    var changedArgs = [];
    var loadingChangedArgs = [];
    var loadingArgs = [];

    dataSource.changed.add(function(e) {
        changedArgs.push(e);
    });

    dataSource.loadingChanged.add(function(e) {
        loadingChangedArgs.push(e);
    });

    var customLoadData = false;
    this.loadingCount = 0;

    dataSource.changeRowExpand([6]);

    dataSource.store().on("loading", function(e) {
        loadingArgs.push(e);
    });

    //act
    dataSource.load().done(function(data) {
        customLoadData = data;
    });

    //assert
    assert.deepEqual(customLoadData, [{ key: 6, items: [6], count: 1 }, { key: 7, items: null, collapsedItems: null, count: 1 }], "custom load data");
    assert.equal(changedArgs.length, 1, "changed is fired");
    assert.deepEqual(loadingChangedArgs, [true, false, true, false], "loadingChanged args");
    assert.deepEqual(loadingArgs, [{
        group: null, requireTotalCount: false, requireGroupCount: false, searchOperation: "contains", searchValue: null, userData: {},
        sort: [{ selector: "this", desc: false }],
        filter: [["this", ">", "5"], "and", ["this", "=", 6]],
        skip: undefined,
        take: undefined
    }], "loading args");

    assert.deepEqual(dataSource.items(), [{ key: 6, items: [6] }, { key: 7, items: null }], "items on page");
    assert.deepEqual(dataSource.totalCount(), 5, "totalCount");
    assert.deepEqual(this.loadingCount, 1, "loading count");
});

//T324247
QUnit.test("load when remote grouping and isLoadingAll", function(assert) {
    var dataSource = this.createDataSource({
        filter: ["this", ">", "5"],
        remoteOperations: true
    });
    dataSource.load();

    var changedArgs = [];
    var loadingChangedArgs = [];

    dataSource.changed.add(function(e) {
        changedArgs.push(e);
    });

    dataSource.loadingChanged.add(function(e) {
        loadingChangedArgs.push(e);
    });

    var customLoadData = false;
    this.loadingCount = 0;

    //act
    dataSource.load({
        isLoadingAll: true,
        filter: ["this", ">", "5"],
        group: "this"
    }).done(function(data) {
        customLoadData = data;
    });

    //assert
    assert.deepEqual(customLoadData, [6, 7, 8, 9, 10].map(function(key) {
        return { key: key, items: [key], count: 1 };
    }), "custom load data");
    assert.ok(!changedArgs.length, "changed is not fired");
    assert.deepEqual(loadingChangedArgs, [true, false], "loadingChanged args");

    assert.deepEqual(dataSource.items(), [6, 7, 8], "items on page");
    assert.deepEqual(dataSource.totalCount(), 5, "totalCount");

    assert.deepEqual(this.loadingCount, 2, "loading count");
});

//T359403
QUnit.test("load with group and paging options", function(assert) {
    var loadingCount = 0,
        dataSource = this.createDataSource({
            store: {
                onLoading: function() {
                    loadingCount++;
                },
                type: "array",
                data: [1, 1, 2, 2, 3, 3, 4, 4, 5, 5]
            },

            pageSize: 5,
            remoteOperations: { filtering: true, sorting: true, paging: true }
        });
    dataSource.load();

    var changedArgs = [];
    var loadingChangedArgs = [];

    dataSource.changed.add(function(e) {
        changedArgs.push(e);
    });

    dataSource.loadingChanged.add(function(e) {
        loadingChangedArgs.push(e);
    });

    var customLoadData = false;

    //act
    dataSource.load({
        group: "this",
        skip: 2,
        take: 2
    }).done(function(data) {
        customLoadData = data;
    });


    //assert
    assert.deepEqual(customLoadData, [{ key: 3, items: [3, 3] }, { key: 4, items: [4, 4] }], "custom load data");
    assert.ok(!changedArgs.length, "changed is not fired");
    assert.deepEqual(loadingChangedArgs, [true, false], "loadingChanged args");

    assert.deepEqual(dataSource.items(), [1, 1, 2, 2, 3], "items on page");
    assert.deepEqual(dataSource.totalCount(), 10, "totalCount");
    assert.deepEqual(loadingCount, 2, "loading count");
});

