import { middlewareTypes } from '../constants';
import { setStateProp, FULFILLED_ACTION } from '../helpers';

const initialState = {
  middlewareServices: {
    error: false,
    errorStatus: null,
    errorMessage: null,
    pending: false,
    fulfilled: false,
    data: {}
  }
};

const middlewareReducers = (state = initialState, action) => {
  if (action.type === FULFILLED_ACTION(middlewareTypes.CREATE_WALKTHROUGH)) {
    const createData = Object.assign({}, state.middlewareServices.data);
    createData[action.payload.spec.clusterServiceClassExternalName] = action.payload;
    return setStateProp(
      'middlewareServices',
      {
        data: createData
      },
      {
        state,
        initialState
      }
    );
  }
  if (action.type === FULFILLED_ACTION(middlewareTypes.REMOVE_WALKTHROUGH)) {
    const removeData = Object.assign({}, state.middlewareServices.data);
    delete removeData[action.payload.spec.clusterServiceClassExternalName];
    return setStateProp(
      'middlewareServices',
      {
        data: removeData
      },
      {
        state,
        initialState
      }
    );
  }
  return state;
};

middlewareReducers.initialState = initialState;

export { middlewareReducers as default, middlewareReducers, initialState };
