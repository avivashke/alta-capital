# ============================================================
# Alta Capital — auto-generated strategy artifact
# Desk: תוך־יומי · 15 דקות · ETHUSDT · 15m
# Version: v1.0 · Strategy family: momentum
# Backtest: return 1.98% · PF 1.29 · DD 4.04% · trades 28
# OOS: 4.07% · Sharpe 2.78
# Params: {"period":21,"threshold":0.8,"atrStop":3.6,"rr":2.2}
# Target platform: Freqtrade
# Generated: 2026-11-13T06:16:57.382Z
# Research artifact only — no warranty, no live order routing.
# ============================================================
# Drop this file in freqtrade/user_data/strategies/ and run:
#   freqtrade backtesting --strategy Altadesk_15m --config user_data/config.json
#   freqtrade trade --strategy Altadesk_15m --config user_data/config.json --dry-run

from freqtrade.strategy import IStrategy
from pandas import DataFrame
import talib.abstract as ta


class Altadesk_15m(IStrategy):
    INTERFACE_VERSION = 3

    timeframe = '15m'
    can_short = True
    startup_candle_count = 210

    stoploss = -0.043
    minimal_roi = {"0": 1.98, "240": 0.01, "720": 0}

    trailing_stop = False
    process_only_new_candles = True
    use_exit_signal = True
    exit_profit_only = False

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe['roc'] = ta.ROC(dataframe, timeperiod=21)
        dataframe['atr'] = ta.ATR(dataframe, timeperiod=14)
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            (
        & (dataframe['roc'] > 0.80)
                & (dataframe['volume'] > 0)
            ),
            'enter_long',
        ] = 1
        dataframe.loc[
            (
        & (dataframe['roc'] < -0.80)
                & (dataframe['volume'] > 0)
            ),
            'enter_short',
        ] = 1
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        # Risk-managed exits: ATR stop + fixed R multiple handled by the engine.
        dataframe.loc[
            (
        & (dataframe['roc'] > 0.80)
            ),
            'exit_short',
        ] = 1
        dataframe.loc[
            (
        & (dataframe['roc'] < -0.80)
            ),
            'exit_long',
        ] = 1
        return dataframe
