'use strict';

const loaders = require('./loaders');
const humps = require('humps');
const {
    connectionFromArraySlice,
    cursorToOffset
} = require('graphql-relay')

/**
 * Quick workaround allowing GraphQL to access model attributes directly
 * (to access a bookshelf model attribute (like model.name), we have to use the .get() method)
 *
 * @param {object} collection
 * @returns {*}
 */
function exposeAttributes(collection) {
    function exposeModelAttributes(item) {
        // Make sure that relations are excluded
        return Object.assign(item, item.serialize({ shallow: true }));
    }
    if (collection) {

        if (collection.hasOwnProperty('edges')) {
            collection.edges = collection.edges.map((item) => {
                item.node = exposeModelAttributes(item.node)
                return item
            })

            return collection
        }

        if (collection.hasOwnProperty('length')) {
            return collection.map((item) => { return exposeModelAttributes(item); });
        }

        return exposeModelAttributes(collection);
    }
    return collection;
}

module.exports = {

    /**
     *
     * @returns {function}
     */
    getLoaders() {
        return loaders;
    },

    /**
     *
     * @param {function} Model
     * @returns {function}
     */
    resolverFactory(Model) {
        return function resolver(modelInstance, args, context, info, extra) {
            const {first, after} = args
            delete args.first
            delete args.after
            const fieldName = humps.decamelize(info.fieldName);
            const isAssociation = (typeof Model.prototype[fieldName] === 'function');
            let model = isAssociation ? modelInstance.related(fieldName) : new Model();
            for (const key in args) {
                model.query(qb => {
                    const tableName = (typeof model.tableName === 'function')
                        ? model.tableName()
                        : model.tableName
                    qb.where(`${tableName}.${key}`, args[key])
                })
            }

            if (extra) {
                if (typeof extra === 'function') {
                    extra(model)
                } else {
                    for (const key in extra) {
                        model[key](...extra[key]);
                        delete extra.key;
                    }
                }
            }
            if (isAssociation) {
                context && context.loaders && context.loaders(model);
                return model.fetch().then((c) => { return exposeAttributes(c); });
            }

            if (first !== undefined || after !== undefined || fieldName.includes('_connection')) {
                const firstAfter = {first, after}

                return model
                    .fetchPage(
                        forwardConnectionArgsToLimitAndOffset(firstAfter)
                    )
                    .then(
                        paginationResultsToForwardConnectionFields(firstAfter)
                    )
                    .then((c) => { return exposeAttributes(c); });
            }
            const fn = (info.returnType.constructor.name === 'GraphQLList') ? 'fetchAll' : 'fetch';
            return model[fn]().then((c) => { return exposeAttributes(c); });
        };
    },

};


const paginationResultsToForwardConnectionFields = args => results => {
    const connection = connectionFromArraySlice(
        results.models,
        args,
        {
            sliceStart: args.after && (cursorToOffset(args.after) + 1) || 0,
            arrayLength: results.pagination.rowCount
        }
    )

    connection.total = results.pagination.rowCount

    return connection
}

const forwardConnectionArgsToLimitAndOffset = ({first, after}) =>
    ({
        limit: first || 0,
        offset: after && cursorToOffset(after) && (cursorToOffset(after) + 1) || 0
    })