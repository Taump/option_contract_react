import {
  CHANGE_ACTIVE_AA,
  GET_BALANCE_ACTIVE_AA,
  UPDATE_INFO_ACTIVE_AA,
  CLEAR_BALANCE_ACTIVE_AA,
  LOAD_AA_LIST_REQUEST,
  LOAD_AA_LIST_SUCCESS,
  ADD_AA_NOTIFICATION,
  LOADING_NOTIFICATION,
  SUBSCRIBE_AA,
  CLEAR_SUBSCRIBE_AA,
  SUBSCRIBE_BASE_AA,
  ADD_AA_TO_LIST,
  LOADING_FULL_NOTIFICATION
} from "../types/aa";
import { notification } from "antd";
import moment from "moment";
import { isEqual } from "lodash";
import client from "../../socket";
import config from "../../config";
import utils from "../../utils";
import { deployRequest, pendingDeployResponse } from "./deploy";
const {
  createObjectNotification,
  isAddressByBase,
  createStringDescrForAa
} = utils;

export const getAasByBase = () => async dispatch => {
  try {
    await dispatch({
      type: LOAD_AA_LIST_REQUEST
    });
    const aaByBase = await client.api.getAasByBaseAas({
      base_aa: config.base_aa
    });
    if (aaByBase && aaByBase !== []) {
      aaByBase.forEach(aa => {
        const {
          feed_name,
          comparison,
          expiry_date,
          feed_value
        } = aa.definition[1].params;
        aa.view = createStringDescrForAa(
          aa.address,
          feed_name,
          comparison,
          expiry_date,
          feed_value
        );
      });
    }
    await dispatch({
      type: LOAD_AA_LIST_SUCCESS,
      payload: aaByBase || []
    });
  } catch (e) {
    console.log("error", e);
  }
};

export const changeActiveAA = address => async (dispatch, getState) => {
  try {
    const store = getState();
    const isValid = await isAddressByBase(address);
    if (isValid || store.deploy.wasIssued) {
      if (store.deploy.wasIssued) {
        await dispatch({
          type: CHANGE_ACTIVE_AA,
          payload: { address, aaVars: {} }
        });
      } else {
        const aaState = await client.api.getAaStateVars({ address });
        await dispatch({
          type: CHANGE_ACTIVE_AA,
          payload: { address, aaVars: aaState }
        });
      }
      const subscriptions = store.aa.subscriptions;
      const isSubscription =
        subscriptions.filter(aa => aa === address).length > 0;
      await dispatch(getAllNotificationAA(address));
      if (!isSubscription) {
        await dispatch(subscribeAA(address));
      }
    } else {
      console.log("Address is not found");
      notification["error"]({
        message: "Address is not found"
      });
    }
  } catch (e) {
    console.log("error", e);
  }
};

export const updateInfoActiveAA = address => async (dispatch, getState) => {
  try {
    const store = getState();
    if (store.deploy.wasIssued !== address) {
      const aaState = await client.api.getAaStateVars({ address });
      dispatch({
        type: UPDATE_INFO_ACTIVE_AA,
        payload: { address, aaVars: aaState }
      });
    }
  } catch (e) {
    console.log("error", e);
  }
};

export const getBalanceActiveAA = address => async dispatch => {
  try {
    const balance = await client.api.getBalances([address]);
    dispatch({
      type: GET_BALANCE_ACTIVE_AA,
      payload: { balance: balance[address], address }
    });
  } catch (e) {
    console.log("error", e);
  }
};

const openNotificationRequest = (address, event) => {
  notification.open({
    message: address,
    description: event,
    style: { minWidth: 350 }
  });
};

export const watchRequestAas = () => (dispatch, getState) => {
  try {
    client.subscribe(async (err, result) => {
      const store = getState();
      const aaActive = store.aa.active;
      if (result[1].subject === "light/aa_request") {
        const AA = result[1].body.aa_address;
        const aaVars =
          store.deploy.wasIssued !== AA
            ? await client.api.getAaStateVars({ address: AA })
            : {};
        if (
          result[1].body &&
          result[1].body.aa_address &&
          result[1].body.unit.messages &&
          result[1].body.unit.messages[0]
        ) {
          const notificationObject = createObjectNotification.req(
            result[1],
            aaVars
          );
          if (
            (notificationObject && notificationObject.AA === aaActive) ||
            (!aaActive && notificationObject)
          ) {
            openNotificationRequest(
              notificationObject.AA,
              notificationObject.title
            );
            dispatch({
              type: ADD_AA_NOTIFICATION,
              payload: notificationObject
            });
          }
        }
      } else if (result[1].subject === "light/aa_response") {
        const AA = result[1].body.aa_address;
        const aaVars = await client.api.getAaStateVars({ address: AA });
        if (
          result[1].body &&
          result[1].body.response &&
          result[1].body.response
        ) {
          const notificationObject = createObjectNotification.res(
            result[1].body,
            aaVars
          );
          if (
            (notificationObject && notificationObject.AA === aaActive) ||
            (!aaActive && notificationObject)
          ) {
            openNotificationRequest(
              notificationObject.AA,
              notificationObject.title
            );
            dispatch({
              type: ADD_AA_NOTIFICATION,
              payload: notificationObject
            });
          }
        }
      } else if (result[1].subject === "light/aa_definition") {
        const address =
          result[1].body.messages[0].payload &&
          result[1].body.messages[0].payload.address;
        if (address) {
          openNotificationRequest(
            "Deployment Request for New AA",
            `Its address is ${address}`
          );
          const params =
            result[1].body.messages[0].payload.definition &&
            result[1].body.messages[0].payload.definition[1] &&
            result[1].body.messages[0].payload.definition[1].params;
          if (
            store.deploy.pending &&
            params &&
            isEqual(store.deploy.deployAaPrams, params)
          ) {
            const address = result[1].body.messages[0].payload.address;
            const definition = result[1].body.messages[0].payload.definition;
            if (address && definition) {
              const {
                feed_name,
                comparison,
                expiry_date,
                feed_value
              } = definition[1].params;
              const view = createStringDescrForAa(
                address,
                feed_name,
                comparison,
                expiry_date,
                feed_value
              );
              await dispatch({
                type: ADD_AA_TO_LIST,
                payload: { address, definition, view }
              });
              await dispatch(deployRequest(address));
              await dispatch(changeActiveAA(address));
            }
          }
        }
      } else if (result[1].subject === "light/aa_definition_saved") {
        const address =
          result[1].body.messages[0].payload &&
          result[1].body.messages[0].payload.address;
        const definition =
          result[1].body.messages[0].payload &&
          result[1].body.messages[0].payload.definition;
        if (address && definition) {
          openNotificationRequest(
            "AA was successfully deployed",
            `Its address is ${address}`
          );
          const {
            feed_name,
            comparison,
            expiry_date,
            feed_value
          } = definition[1].params;
          const view = createStringDescrForAa(
            address,
            feed_name,
            comparison,
            expiry_date,
            feed_value
          );
          dispatch({
            type: ADD_AA_TO_LIST,
            payload: { address, definition, view }
          });
          if (address === store.deploy.wasIssued) {
            dispatch(pendingDeployResponse());
          }
        }
      }
    });
  } catch (e) {
    console.log("error", e);
  }
};

export const clearBalanceActiveAA = () => ({
  type: CLEAR_BALANCE_ACTIVE_AA
});

export const clearSubscribesAA = () => ({
  type: CLEAR_SUBSCRIBE_AA
});

export const getAllNotificationAA = address => async (dispatch, getState) => {
  const store = getState();
  if (address !== store.deploy.wasIssued) {
    const notifications = await client.api.getAaResponses({
      aa: address
    });
    const aaVars = await client.api.getAaStateVars({ address });

    let notificationsList = [];
    await notifications.forEach(n => {
      const notificationObject = createObjectNotification.res(n, aaVars);
      if (notificationObject) {
        notificationsList.push(notificationObject);
      }
    });
    await dispatch({
      type: LOADING_NOTIFICATION,
      payload: notificationsList
    });
  } else {
    await dispatch({
      type: LOADING_NOTIFICATION,
      payload: []
    });
  }
};

export const subscribeAA = address => async (dispatch, getState) => {
  const store = getState();
  const subscriptions = store.aa.subscriptions;
  const isSubscription = subscriptions.filter(aa => aa === address).length > 0;
  if (!isSubscription) {
    await client.justsaying("light/new_aa_to_watch", {
      aa: address
    });

    await dispatch({
      type: SUBSCRIBE_AA,
      payload: address
    });
  }
};

export const subscribeActualAA = () => async (dispatch, getState) => {
  const store = getState();
  const { listByBase } = store.aa;
  if (listByBase) {
    let notificationsList = [];
    for (const aa of listByBase) {
      const params =
        aa.definition && aa.definition[1] && aa.definition[1].params;
      const address = aa.address;
      const { expiry_date } = params;
      const isValid = moment(expiry_date).isValid();
      if (isValid) {
        const expiryDate = moment(expiry_date);
        const isAfter = expiryDate.isAfter(moment().add(-7, "d"));
        if (isAfter) {
          dispatch(subscribeAA(address));
          const notificationsAA = await client.api.getAaResponses({
            aa: address
          });
          const aaVars = await client.api.getAaStateVars({ address });
          for (const notification of notificationsAA) {
            const notificationObject = createObjectNotification.res(
              notification,
              aaVars
            );
            if (notificationObject && store.aa.active === null) {
              notificationsList.push(notificationObject);
            }
          }
        }
      }
    }

    await dispatch({
      type: LOADING_FULL_NOTIFICATION,
      payload: notificationsList
    });
  }
};

export const subscribeBaseAA = () => async dispatch => {
  await client.justsaying("light/new_aa_to_watch", {
    aa: config.base_aa
  });
  await dispatch({
    type: SUBSCRIBE_BASE_AA
  });
};
